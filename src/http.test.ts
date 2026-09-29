import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { config } from "./config";
import { buildApp, extractCredential, isAnonymousRequest } from "./http";
import { resetOAuthVerifier } from "./lib/oauth";

import type { Request } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const fakeReq = (authorization?: string, pathKey?: string): Request =>
  ({
    headers: authorization !== undefined ? { authorization } : {},
    params: pathKey !== undefined ? { apiKey: pathKey } : {},
  }) as unknown as Request;

describe("extractCredential", () => {
  it("parses a Bearer header", () => {
    expect(extractCredential(fakeReq("Bearer sk_live_abc"))).toBe(
      "sk_live_abc",
    );
  });

  it("is case-insensitive on the scheme", () => {
    expect(extractCredential(fakeReq("bearer sk_live_abc"))).toBe(
      "sk_live_abc",
    );
  });

  it("parses an ApiKey header", () => {
    expect(extractCredential(fakeReq("ApiKey sk_live_abc"))).toBe(
      "sk_live_abc",
    );
  });

  it("accepts a bare key with surrounding whitespace", () => {
    expect(extractCredential(fakeReq("  sk_live_abc  "))).toBe("sk_live_abc");
  });

  it("falls back to the path parameter", () => {
    expect(extractCredential(fakeReq(undefined, "sk_live_path"))).toBe(
      "sk_live_path",
    );
  });

  it("prefers the header over the path parameter", () => {
    expect(extractCredential(fakeReq("Bearer sk_header", "sk_path"))).toBe(
      "sk_header",
    );
  });

  it("returns undefined when neither is present", () => {
    expect(extractCredential(fakeReq())).toBeUndefined();
  });

  it("carries an OAuth token through unchanged", () => {
    expect(extractCredential(fakeReq("Bearer eyJhbG.eyJzdWI.sig"))).toBe(
      "eyJhbG.eyJzdWI.sig",
    );
  });
});

describe("isAnonymousRequest", () => {
  it("allows the handshake and the listings", () => {
    expect(isAnonymousRequest({ method: "initialize" })).toBe(true);
    expect(isAnonymousRequest({ method: "tools/list" })).toBe(true);
    expect(isAnonymousRequest({ method: "ping" })).toBe(true);
  });

  it("refuses anything that reaches the cloro API", () => {
    expect(isAnonymousRequest({ method: "tools/call" })).toBe(false);
    expect(isAnonymousRequest({ method: "resources/read" })).toBe(false);
  });

  it("refuses methods this server does not implement", () => {
    // The server registers tools only. A client has no reason to call these,
    // because the handshake never advertises the capability -- so they are not
    // on the anonymous list, and a caller that tries one needs a credential
    // like any other unrecognised method.
    expect(isAnonymousRequest({ method: "prompts/list" })).toBe(false);
    expect(isAnonymousRequest({ method: "resources/list" })).toBe(false);
  });

  it("refuses a batch that smuggles a tool call past a handshake", () => {
    expect(
      isAnonymousRequest([{ method: "initialize" }, { method: "tools/call" }]),
    ).toBe(false);
  });

  it("allows a batch only when every entry is a discovery method", () => {
    expect(
      isAnonymousRequest([{ method: "initialize" }, { method: "tools/list" }]),
    ).toBe(true);
  });

  it("refuses a body with no method, an empty batch, or a non-object", () => {
    expect(isAnonymousRequest({})).toBe(false);
    expect(isAnonymousRequest([])).toBe(false);
    expect(isAnonymousRequest(undefined)).toBe(false);
    expect(isAnonymousRequest("initialize")).toBe(false);
  });
});

const initializeBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
});

const toolsCallBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "scrape_chatgpt",
    arguments: { prompt: "hi", country: "US" },
  },
});

describe("HTTP transport (OAuth not configured)", () => {
  const { app, beginShutdown } = buildApp();
  const server: Server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  afterAll(() => {
    server.close();
  });

  it("completes the handshake with no credential at all", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: initializeBody,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"name":"cloro"');
  });

  it("lists tools with no credential, so a client can see what is on offer", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("scrape_chatgpt");
  });

  it("rejects a tool call without a credential, and sends no challenge", async () => {
    // With no authorization server configured there is nowhere to send the
    // client, so a challenge would name a document that advertises nothing.
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: toolsCallBody,
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("omits authorization_servers from the metadata", async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resource).toBe("https://mcp.cloro.dev/mcp");
    expect(body).not.toHaveProperty("authorization_servers");
    expect(body).not.toHaveProperty("scopes_supported");
  });

  it("initializes with a path-embedded key", async () => {
    const res = await fetch(`${base}/sk_test_dummy/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: initializeBody,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"name":"cloro"');
  });

  it.each(["GET", "DELETE"])("responds 405 to %s /mcp", async (method) => {
    const res = await fetch(`${base}/mcp`, { method });
    expect(res.status).toBe(405);
  });

  it("serves /health ok, then 503 once shutdown begins", async () => {
    const healthy = await fetch(`${base}/health`);
    expect(healthy.status).toBe(200);

    beginShutdown();

    const draining = await fetch(`${base}/health`);
    expect(draining.status).toBe(503);
  });
});

describe("HTTP transport (OAuth configured)", () => {
  const ISSUER = "https://clerk.cloro.test";
  const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

  let server: Server;
  let base: string;
  type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  let signingKey: PrivateKey;
  let realFetch: typeof fetch;
  let jwksDown = false;
  /** Authorization header of the last request the tool layer made upstream. */
  let upstreamAuth: string | undefined;

  async function mint(
    claims: {
      org_id?: string | null;
      expiresIn?: string;
      /** `null` omits the claim. Defaults to this server's resource URI. */
      aud?: string | null;
    } = {},
  ): Promise<string> {
    const {
      org_id = "org_test",
      expiresIn = "1h",
      aud = "https://mcp.cloro.dev/mcp",
    } = claims;
    const jwt = new SignJWT({
      ...(org_id === null ? {} : { org_id }),
      scope: "profile email user:org:read",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setSubject("user_test")
      .setIssuedAt()
      .setExpirationTime(expiresIn);
    if (aud !== null) jwt.setAudience(aud);
    return jwt.sign(signingKey);
  }

  beforeAll(async () => {
    vi.stubEnv("CLERK_ISSUER", ISSUER);
    resetOAuthVerifier();

    const pair = await generateKeyPair("RS256", { extractable: true });
    signingKey = pair.privateKey;
    const jwk = await exportJWK(pair.publicKey);
    const jwks = {
      keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }],
    };

    // Nothing leaves the process: the JWKS and the cloro API are served from
    // memory, and only the loopback server under test gets the real fetch.
    realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url = String(input);
        if (url === JWKS_URL) {
          if (jwksDown) throw new TypeError("fetch failed");
          return new Response(JSON.stringify(jwks), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.startsWith(config.apiUrl)) {
          upstreamAuth = (init?.headers as Record<string, string> | undefined)
            ?.authorization;
          return new Response(
            JSON.stringify({ success: true, result: { text: "answer" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.startsWith(base)) {
          return realFetch(input, init);
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );

    const { app } = buildApp();
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetOAuthVerifier();
  });

  const callTool = (token?: string) =>
    realFetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: toolsCallBody,
    });

  it("advertises the authorization server and scopes", async () => {
    const res = await realFetch(
      `${base}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resource).toBe("https://mcp.cloro.dev/mcp");
    expect(body.authorization_servers).toEqual([ISSUER]);
    expect(body.scopes_supported).toEqual([
      "profile",
      "email",
      "user:org:read",
    ]);
  });

  it("serves the same document at both well-known paths", async () => {
    const [bare, suffixed] = await Promise.all([
      realFetch(`${base}/.well-known/oauth-protected-resource`),
      realFetch(`${base}/.well-known/oauth-protected-resource/mcp`),
    ]);
    expect(await bare.json()).toEqual(await suffixed.json());
  });

  it("challenges an unauthenticated tool call with WWW-Authenticate", async () => {
    const res = await callTool();
    expect(res.status).toBe(401);

    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain("Bearer ");
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain(
      'resource_metadata="https://mcp.cloro.dev/.well-known/oauth-protected-resource/mcp"',
    );
    expect(challenge).toContain('scope="profile email user:org:read"');
  });

  it("still completes the handshake unchallenged", async () => {
    const res = await realFetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: initializeBody,
    });
    expect(res.status).toBe(200);
  });

  it("accepts a valid token and forwards it to the API verbatim", async () => {
    const token = await mint();
    upstreamAuth = undefined;
    const res = await callTool(token);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('"isError":true');
    expect(upstreamAuth).toBe(`Bearer ${token}`);
  });

  it("answers 503 with no challenge when the JWKS cannot be fetched", async () => {
    // A fresh verifier has no cached keys, so the first token forces a fetch.
    resetOAuthVerifier();
    jwksDown = true;
    try {
      const res = await callTool(await mint());
      expect(res.status).toBe(503);
      expect(res.headers.get("www-authenticate")).toBeNull();
    } finally {
      jwksDown = false;
      resetOAuthVerifier();
    }
  });

  it("challenges an expired token", async () => {
    const res = await callTool(await mint({ expiresIn: "-1h" }));
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain("(expired)");
  });

  it("challenges a token minted for another resource", async () => {
    // The MCP spec requires a resource server to accept only tokens issued
    // for it. A token with no `aud` cannot prove that, so it fails the same
    // way as one naming a different resource.
    for (const aud of ["https://other.example/mcp", null]) {
      const res = await callTool(await mint({ aud }));
      expect(res.status, `aud=${aud}`).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("(wrong_audience)");
    }
  });

  it("challenges a token with no organization using the RFC 6750 code", async () => {
    // The reason is named in error_description, never in `error`: RFC 6750
    // registers three codes and a client may key re-authentication on them,
    // so a custom `missing_organization` code could be treated as terminal.
    const res = await callTool(await mint({ org_id: null }));
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).not.toContain('error="missing_organization"');
    expect(challenge).toContain("(missing_organization)");
  });

  it("forwards an API key without verifying it as a token", async () => {
    const key = `sk_live_${"a1b2c3d4".repeat(4)}`;
    upstreamAuth = undefined;
    const res = await callTool(key);
    // Not challenged: an sk_ key is not a JWT, so it goes upstream untouched
    // and the API is the one that decides whether it is valid.
    expect(res.status).toBe(200);
    expect(upstreamAuth).toBe(`Bearer ${key}`);
  });
});
