import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { config } from "./config";
import { buildServer } from "./server";

/**
 * stdio transport (internal development only): the MCP client spawns this
 * process and owns the key via env. stdout carries the JSON-RPC stream, so
 * all human-facing output goes to stderr.
 */
export async function runStdioServer(): Promise<void> {
  const { apiKey } = config;
  if (!apiKey) {
    process.stderr.write(
      "CLORO_API_KEY is required in stdio mode. Get your API key from the cloro dashboard.\n",
    );
    process.exit(1);
  }

  const server = buildServer(apiKey);
  await server.connect(new StdioServerTransport());
  process.stderr.write("cloro MCP server running on stdio\n");
}
