import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createOAuthTokenVerifier } from "./verify";

const ISSUER = "https://clerk.cloro.dev";
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const RESOURCE = "https://mcp.cloro.dev/mcp";

let signingKey: CryptoKey;
/** A second, unrelated key pair — its tokens must never verify. */
let foreignKey: CryptoKey;
/** What the JWKS endpoint answers; tests swap it to simulate an outage. */
let jwksResponder: () => Response | Promise<Response>;
let serveJwks: () => Response;

interface Claims {
  sub?: string;
  /** `null` omits the claim — `undefined` would just re-apply the default. */
  org_id?: string | null;
  scope?: string;
  aud?: string | string[];
  iss?: string;
  expiresIn?: string;
  key?: CryptoKey;
}

async function mint(claims: Claims = {}): Promise<string> {
  const {
    sub = "user_123",
    org_id = "org_456",
    scope = "profile email user:org:read",
    aud,
    iss = ISSUER,
    expiresIn = "1h",
    key = signingKey,
  } = claims;

  const jwt = new SignJWT({
    ...(org_id === null ? {} : { org_id }),
    scope,
    client_id: "client_789",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(iss)
    .setIssuedAt()
    .setExpirationTime(expiresIn);

  if (sub !== undefined) jwt.setSubject(sub);
  if (aud !== undefined) jwt.setAudience(aud);

  return jwt.sign(key);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const foreign = await generateKeyPair("RS256", { extractable: true });
  signingKey = pair.privateKey;
  foreignKey = foreign.privateKey;

  const jwk = await exportJWK(pair.publicKey);
  const jwks = {
    keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }],
  };

  serveJwks = () =>
    new Response(JSON.stringify(jwks), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  jwksResponder = serveJwks;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (String(input) !== JWKS_URL) {
      throw new Error(`unexpected fetch: ${String(input)}`);
    }
    return jwksResponder();
  });
});

afterEach(() => {
  jwksResponder = serveJwks;
  vi.clearAllMocks();
});

describe("createOAuthTokenVerifier", () => {
  it("accepts a well-formed token and returns the principal", async () => {
    const verify = createOAuthTokenVerifier({ issuer: ISSUER });
    const result = await verify(await mint());

    expect(result).toEqual({
      ok: true,
      principal: {
        userId: "user_123",
        organizationId: "org_456",
        scopes: ["profile", "email", "user:org:read"],
        clientId: "client_789",
      },
    });
  });

  it("derives the JWKS URL from the issuer and tolerates a trailing slash", async () => {
    const verify = createOAuthTokenVerifier({ issuer: `${ISSUER}/` });
    const result = await verify(await mint());
    expect(result.ok).toBe(true);
  });

  it("rejects an expired token", async () => {
    const verify = createOAuthTokenVerifier({ issuer: ISSUER });
    const result = await verify(await mint({ expiresIn: "-1h" }));
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token from another issuer", async () => {
    const verify = createOAuthTokenVerifier({ issuer: ISSUER });
    const result = await verify(await mint({ iss: "https://evil.example" }));
    expect(result).toEqual({ ok: false, reason: "wrong_issuer" });
  });

  it("rejects a token signed by an unknown key", async () => {
    const verify = createOAuthTokenVerifier({ issuer: ISSUER });
    const result = await verify(await mint({ key: foreignKey }));
    expect(result.ok).toBe(false);
  });

  it("rejects a token with no org_id — there is no account to charge", async () => {
    const verify = createOAuthTokenVerifier({ issuer: ISSUER });
    const result = await verify(await mint({ org_id: null }));
    expect(result).toEqual({ ok: false, reason: "missing_organization" });
  });

  it("rejects a mismatched audience when one is configured", async () => {
    const verify = createOAuthTokenVerifier({
      issuer: ISSUER,
      audience: RESOURCE,
    });
    const result = await verify(await mint({ aud: "https://elsewhere.test" }));
    expect(result).toEqual({ ok: false, reason: "wrong_audience" });
  });

  it("accepts a matching audience, including the array form", async () => {
    const verify = createOAuthTokenVerifier({
      issuer: ISSUER,
      audience: RESOURCE,
    });

    expect((await verify(await mint({ aud: RESOURCE }))).ok).toBe(true);
    expect(
      (await verify(await mint({ aud: ["https://other.test", RESOURCE] }))).ok,
    ).toBe(true);
  });

  it("rejects a token with no aud claim when an audience is configured", async () => {
    // Clerk writes the `resource` parameter into `aud` once aud_claim_enabled
    // is on. A missing claim therefore means the instance is misconfigured,
    // and the resource server must fail closed rather than accept a token it
    // cannot prove was minted for it.
    const verify = createOAuthTokenVerifier({
      issuer: ISSUER,
      audience: RESOURCE,
    });
    expect(await verify(await mint())).toEqual({
      ok: false,
      reason: "wrong_audience",
    });
  });

  it("ignores aud entirely when no audience is configured", async () => {
    const verify = createOAuthTokenVerifier({ issuer: ISSUER });
    expect((await verify(await mint({ aud: "https://anything" }))).ok).toBe(
      true,
    );
  });

  it("reports the key set as unavailable when the JWKS fetch fails", async () => {
    const outages: Array<[string, () => Response | Promise<Response>]> = [
      ["network error", () => Promise.reject(new TypeError("fetch failed"))],
      [
        "timeout",
        () =>
          Promise.reject(
            Object.assign(new Error("aborted"), { name: "TimeoutError" }),
          ),
      ],
      ["non-200", () => new Response("upstream down", { status: 503 })],
      ["not JSON", () => new Response("<html>", { status: 200 })],
    ];
    for (const [label, responder] of outages) {
      jwksResponder = responder;
      const verify = createOAuthTokenVerifier({ issuer: ISSUER });
      const result = await verify(await mint());
      expect(result, label).toEqual({ ok: false, reason: "unavailable" });
    }
  });

  it("rejects a syntactically broken token", async () => {
    const verify = createOAuthTokenVerifier({ issuer: ISSUER });
    const result = await verify("not-a-jwt");
    expect(result.ok).toBe(false);
  });
});
