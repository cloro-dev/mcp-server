import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createSessionTokenVerifier, looksLikeSessionToken } from "./session";

const ISSUER = "https://clerk.cloro.dev";
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

let signingKey: CryptoKey;
/** A second, unrelated key pair — its tokens must never verify. */
let foreignKey: CryptoKey;

interface Claims {
  sub?: string;
  /** `null` omits the claim. */
  sid?: string | null;
  /** The version 2 organization claim. `null` omits it. */
  o?: { id: string } | null;
  /** The version 1 organization claim. */
  org_id?: string;
  iss?: string;
  expiresIn?: string;
  /** `nbf` claim, as an offset from now. */
  notBefore?: string;
  key?: CryptoKey;
}

async function mint(claims: Claims = {}): Promise<string> {
  const {
    sub = "user_123",
    sid = "sess_789",
    o = { id: "org_456" },
    org_id,
    iss = ISSUER,
    expiresIn = "1h",
    notBefore,
    key = signingKey,
  } = claims;

  const jwt = new SignJWT({
    ...(sid === null ? {} : { sid }),
    ...(o === null ? {} : { o, v: 2 }),
    ...(org_id === undefined ? {} : { org_id }),
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(iss)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn);
  if (notBefore !== undefined) jwt.setNotBefore(notBefore);
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

  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (String(input) !== JWKS_URL) {
      throw new Error(`unexpected fetch: ${String(input)}`);
    }
    return new Response(JSON.stringify(jwks), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("looksLikeSessionToken", () => {
  it("is true for a token with a session id", async () => {
    expect(looksLikeSessionToken(await mint())).toBe(true);
  });

  it("is false for a token without one, such as an OAuth access token", async () => {
    expect(looksLikeSessionToken(await mint({ sid: null }))).toBe(false);
  });

  it("is false for a value that is not a JWT", () => {
    expect(looksLikeSessionToken("sk_live_0123456789abcdef")).toBe(false);
  });
});

describe("createSessionTokenVerifier", () => {
  it("accepts a version 2 token and returns the principal", async () => {
    const verify = createSessionTokenVerifier({ issuer: ISSUER });

    expect(await verify(await mint())).toEqual({
      ok: true,
      principal: {
        userId: "user_123",
        organizationId: "org_456",
        sessionId: "sess_789",
      },
    });
  });

  it("reads the organization from org_id on a version 1 token", async () => {
    const verify = createSessionTokenVerifier({ issuer: ISSUER });
    const result = await verify(await mint({ o: null, org_id: "org_v1" }));

    expect(result).toEqual({
      ok: true,
      principal: {
        userId: "user_123",
        organizationId: "org_v1",
        sessionId: "sess_789",
      },
    });
  });

  it("derives the JWKS URL from the issuer and tolerates a trailing slash", async () => {
    const verify = createSessionTokenVerifier({ issuer: `${ISSUER}/` });
    expect((await verify(await mint())).ok).toBe(true);
  });

  it("rejects an expired token", async () => {
    const verify = createSessionTokenVerifier({ issuer: ISSUER });
    const result = await verify(await mint({ expiresIn: "-1h" }));
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("tolerates a few seconds of clock skew on nbf, but not more", async () => {
    const verify = createSessionTokenVerifier({ issuer: ISSUER });
    expect((await verify(await mint({ notBefore: "3s" }))).ok).toBe(true);
    const tooFar = await verify(await mint({ notBefore: "30s" }));
    expect(tooFar).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("rejects a token from another issuer", async () => {
    const verify = createSessionTokenVerifier({ issuer: ISSUER });
    const result = await verify(await mint({ iss: "https://evil.example" }));
    expect(result).toEqual({ ok: false, reason: "wrong_issuer" });
  });

  it("rejects a token signed by an unknown key", async () => {
    const verify = createSessionTokenVerifier({ issuer: ISSUER });
    expect((await verify(await mint({ key: foreignKey }))).ok).toBe(false);
  });

  it("rejects a token with no organization — there is no account to charge", async () => {
    const verify = createSessionTokenVerifier({ issuer: ISSUER });
    const result = await verify(await mint({ o: null }));
    expect(result).toEqual({ ok: false, reason: "missing_organization" });
  });

  it("rejects a token with no session id", async () => {
    const verify = createSessionTokenVerifier({ issuer: ISSUER });
    const result = await verify(await mint({ sid: null }));
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });
});
