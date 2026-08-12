import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { CloroClient } from "./lib/cloro-client";
import { registerMonitorTools } from "./tools/monitor-tools";
import { registerReferenceTools } from "./tools/reference-tools";

/**
 * Build an MCP server bound to one caller's API key. The server is a thin
 * wrapper over the public cloro API — auth, rate limiting, credits, and
 * concurrency are all enforced by the API itself.
 */
export function buildServer(apiKey: string): McpServer {
  const server = new McpServer({
    name: "cloro",
    version: "0.1.0",
  });

  const client = new CloroClient(apiKey);
  registerMonitorTools(server, client);
  registerReferenceTools(server, client);

  return server;
}
