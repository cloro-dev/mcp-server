import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "./lib/logger";
import { looksLikeOAuthToken } from "./oauth-tokens";
import cors from "cors";
import express, { Express, Request, Response } from "express";

import { config, oauth } from "./config";
import { buildChallenge, getOAuthVerifier } from "./lib/oauth";
import { buildProtectedResourceMetadata } from "./lib/protected-resource-metadata";
import { buildServer } from "./server";

/**
 * Extract the caller's credential. Three forms, mirroring the public API
 * (and SerpApi's hosted MCP) so clients that can't set headers still work:
 *   1. `Authorization: Bearer sk_...` (or `ApiKey sk_...`, or the bare key)
 *   2. `Authorization: Bearer <OAuth access token>`
 *   3. URL path: POST /<api key>/mcp
 *
 * The path form stays API-key-only. It exists for clients that cannot set a
 * header, and an OAuth client is not one of those — the spec forbids putting
 * an access token in a URL, because URLs end up in logs and history.
 */
export function extractCredential(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header) {
    const match = /^(?:Bearer|ApiKey)\s+(.+)$/i.exec(header.trim());
    return (match?.[1] ?? header).trim() || undefined;
  }
  return req.params.apiKey || undefined;
}

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

/**
 * Refuse at the HTTP layer with the challenge the MCP spec defines.
 *
 * This has to happen before the JSON-RPC message reaches the SDK: once a tool
 * handler is running its return value is already destined for a 200, and a 200
 * produces no Connect card.
 */
function unauthorized(
  res: Response,
  message: string,
  description?: string,
): void {
  if (oauth.enabled) {
    res.set("WWW-Authenticate", buildChallenge(description));
  }
  jsonRpcError(res, 401, message);
}

/**
 * JSON-RPC methods answerable with no credential.
 *
 * Handshake and listing describe the server; they read nothing and charge
 * nothing. Requiring a credential for them made `initialize` return 401, which
 * reads to any client -- and to any readiness audit -- as a server that is not
 * running: there is no way to tell a credential problem from a dead
 * deployment when the handshake itself is what fails. Everything that reaches
 * the cloro API still needs one, and `tools/call` is not on this list.
 *
 * This is also exactly the lazy-authentication shape Claude expects: a client
 * connects, lists the tools, and is challenged only when it first calls one.
 *
 * The list covers what this server implements and nothing else. It registers
 * tools only, so `prompts/list` and `resources/list` are not on it: a client
 * has no reason to call a method whose capability the handshake never
 * advertised, and adding one here would be guessing at a client that does.
 */
const ANONYMOUS_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
]);

/**
 * True when every request in the body is a discovery method. A batch is
 * all-or-nothing on purpose: letting a batch through because its first entry
 * is `initialize` would carry an unauthenticated `tools/call` with it.
 */
export function isAnonymousRequest(body: unknown): boolean {
  const entries = Array.isArray(body) ? body : [body];
  if (entries.length === 0) return false;
  return entries.every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { method?: unknown }).method === "string" &&
      ANONYMOUS_METHODS.has((entry as { method: string }).method),
  );
}

const MISSING_CREDENTIAL_MESSAGE =
  "Authentication required. Connect with OAuth, or send a cloro API key as an Authorization: Bearer header.";

/**
 * Stateless Streamable HTTP: every POST gets a fresh server + transport bound
 * to the caller's credential, so one deployment serves all customers with no
 * session state.
 */
async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const credential = extractCredential(req);
  const anonymous = isAnonymousRequest(req.body);

  if (!credential) {
    if (!anonymous) {
      // Never log header or path contents here — both can carry credentials.
      logger.warn("MCP request rejected: no credential", "MCP");
      unauthorized(res, MISSING_CREDENTIAL_MESSAGE);
      return;
    }
  } else if (looksLikeOAuthToken(credential)) {
    // Verify here rather than letting the API do it alone. A token that fails
    // upstream comes back inside a tool result, which cannot carry the 401
    // that drives re-authentication.
    const verify = getOAuthVerifier();
    if (!verify) {
      logger.warn("OAuth token presented but OAuth is not configured", "MCP");
      unauthorized(res, MISSING_CREDENTIAL_MESSAGE);
      return;
    }

    const result = await verify(credential);
    if (!result.ok && result.reason === "unavailable") {
      // Nothing is known about the token. No challenge: a 401 would make the
      // client discard it and re-run the OAuth flow, which fails the same way.
      logger.error("OAuth token verification unavailable", "MCP");
      jsonRpcError(
        res,
        503,
        "OAuth token verification is temporarily unavailable. Retry shortly.",
      );
      return;
    }
    if (!result.ok) {
      logger.warn("MCP request rejected: OAuth token invalid", "MCP", {
        reason: result.reason,
      });
      const message =
        result.reason === "missing_organization"
          ? "This OAuth token is not bound to an organization. Reconnect and grant organization access."
          : "Invalid or expired OAuth access token.";
      unauthorized(res, message, `${message} (${result.reason})`);
      return;
    }
  }

  // An anonymous handshake gets a server whose tools are wired to an empty
  // credential. Listing them never calls the API, and `tools/call` cannot
  // reach here without one, so the empty string is never sent anywhere.
  const server = buildServer(credential ?? "");
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error("Failed to handle MCP request", "MCP", {}, error);
    if (!res.headersSent) {
      jsonRpcError(res, 500, "Internal server error");
    }
  }
}

function methodNotAllowed(_req: Request, res: Response): void {
  jsonRpcError(
    res,
    405,
    "Method not allowed. This server is stateless — send POST requests only.",
  );
}

/** The Express app plus the switch that flips /health to 503 during drain. */
export function buildApp(): { app: Express; beginShutdown: () => void } {
  const app = express();
  // The challenge header is the whole authorization signal, and a browser
  // client cannot read it unless it is explicitly exposed.
  app.use(cors({ exposedHeaders: ["WWW-Authenticate"] }));
  app.use(express.json({ limit: "1mb" }));

  let isShuttingDown = false;

  app.get("/health", (_req, res) => {
    if (isShuttingDown) {
      return res.status(503).json({ status: "shutting down" });
    }
    res.status(200).json({ status: "ok" });
  });

  // RFC 9728 protected resource metadata. Unauthenticated: its job is to tell
  // a client with no credentials how to get one.
  //
  // Both paths serve the same document. RFC 9728 section 3.1 has a client try
  // the path-suffixed form first when the resource URL has a path component,
  // and ours is `/mcp` — so the suffixed path is the one Claude actually
  // probes, and the bare path is the fallback for clients that don't.
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ]) {
    app.get(path, (_req, res) => {
      res
        .type("application/json")
        .set("Cache-Control", "public, max-age=3600")
        .json(buildProtectedResourceMetadata());
    });
  }

  for (const path of ["/mcp", "/:apiKey/mcp"]) {
    app.post(path, (req, res) => {
      void handleMcpRequest(req, res);
    });
    app.get(path, methodNotAllowed);
    app.delete(path, methodNotAllowed);
  }

  return {
    app,
    beginShutdown: () => {
      isShuttingDown = true;
    },
  };
}

export function runHttpServer(): void {
  const { app, beginShutdown } = buildApp();

  const server = app.listen(config.port, () => {
    logger.info(`cloro MCP server listening on port ${config.port}`, "MCP");
    logger.info(
      oauth.enabled
        ? `OAuth enabled — authorization server ${oauth.issuer}`
        : "OAuth disabled (CLERK_ISSUER unset) — API keys only",
      "MCP",
    );
  });

  // Sync scrapes can run up to ~5 min; the client AbortSignal (requestTimeoutMs)
  // is the source of truth for request duration. Node's default requestTimeout
  // is 300s — below our client budget — so a near-limit scrape could be cut off
  // server-side first. Raise it just past the client timeout. Leave
  // keepAliveTimeout at its small default (idle-between-request sockets).
  server.requestTimeout = config.requestTimeoutMs + 10_000;

  // Graceful shutdown: fail health probes so k8s stops routing, then let
  // in-flight MCP requests drain before closing the listener. Also lets
  // tsup's watch-mode restart release the port cleanly between rebuilds.
  const onShutdown = (signal: string) => {
    logger.info(`${signal} received, starting graceful shutdown...`, "MCP");
    beginShutdown();
    server.close(() => {
      logger.info("HTTP server closed", "MCP");
    });
  };
  process.on("SIGTERM", () => onShutdown("SIGTERM"));
  process.on("SIGINT", () => onShutdown("SIGINT"));
}
