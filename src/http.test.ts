import { describe, expect, it, afterAll } from "vitest";

import { buildApp, extractApiKey } from "./http";

import type { Request } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const fakeReq = (authorization?: string, pathKey?: string): Request =>
  ({
    headers: authorization !== undefined ? { authorization } : {},
    params: pathKey !== undefined ? { apiKey: pathKey } : {},
  }) as unknown as Request;

describe("extractApiKey", () => {
  it("parses a Bearer header", () => {
    expect(extractApiKey(fakeReq("Bearer sk_live_abc"))).toBe("sk_live_abc");
  });

  it("is case-insensitive on the scheme", () => {
    expect(extractApiKey(fakeReq("bearer sk_live_abc"))).toBe("sk_live_abc");
  });

  it("parses an ApiKey header", () => {
    expect(extractApiKey(fakeReq("ApiKey sk_live_abc"))).toBe("sk_live_abc");
  });

  it("accepts a bare key with surrounding whitespace", () => {
    expect(extractApiKey(fakeReq("  sk_live_abc  "))).toBe("sk_live_abc");
  });

  it("falls back to the path parameter", () => {
    expect(extractApiKey(fakeReq(undefined, "sk_live_path"))).toBe(
      "sk_live_path",
    );
  });

  it("prefers the header over the path parameter", () => {
    expect(extractApiKey(fakeReq("Bearer sk_header", "sk_path"))).toBe(
      "sk_header",
    );
  });

  it("returns undefined when neither is present", () => {
    expect(extractApiKey(fakeReq())).toBeUndefined();
  });
});

describe("HTTP transport", () => {
  const { app, beginShutdown } = buildApp();
  const server: Server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  afterAll(() => {
    server.close();
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

  it("rejects a POST without an API key with a 401 JSON-RPC error", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: initializeBody,
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Missing API key");
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
