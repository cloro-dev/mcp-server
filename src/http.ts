import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "./lib/logger";
import cors from "cors";
import express, { Express, Request, Response } from "express";

import { config } from "./config";
import { buildServer } from "./server";

/**
 * Extract the caller's cloro API key. Two forms, mirroring the public API
 * (and SerpApi's hosted MCP) so clients that can't set headers still work:
 *   1. `Authorization: Bearer sk_...` (or `ApiKey sk_...`, or the bare key)
 *   2. URL path: POST /<api key>/mcp
 */
export function extractApiKey(req: Request): string | undefined {
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
 * Stateless Streamable HTTP: every POST gets a fresh server + transport bound
 * to the caller's API key, so one deployment serves all customers with no
 * session state.
 */
async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    // Never log header or path contents here — both can carry API keys.
    logger.warn("MCP request rejected: missing API key", "MCP");
    jsonRpcError(
      res,
      401,
      "Missing API key. Send it as an Authorization: Bearer header, or use the /<api key>/mcp path.",
    );
    return;
  }

  const server = buildServer(apiKey);
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
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  let isShuttingDown = false;

  app.get("/health", (_req, res) => {
    if (isShuttingDown) {
      return res.status(503).json({ status: "shutting down" });
    }
    res.status(200).json({ status: "ok" });
  });

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
