import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { CloroClient } from "./lib/cloro-client";
import { registerMonitorTools } from "./tools/monitor-tools";
import { registerReferenceTools } from "./tools/reference-tools";

/**
 * Build an MCP server bound to one caller's API key. The server is a thin
 * wrapper over the public cloro API — auth, rate limiting, credits, and
 * concurrency are all enforced by the API itself.
 */
const INSTRUCTIONS = `cloro scrapes AI answer engines (ChatGPT, Gemini, Copilot, Perplexity, Google AI Mode) and Google Search and News, geo-targeted by country.

Costs: every scrape tool calls the sync API and costs its base credits, plus any add-ons, plus a 2-credit sync surcharge. Each tool description states its cost. Each result carries credits.charged and credits.remaining. list_countries and list_states are free. resolve_google_redirect costs 1 credit and has no surcharge.

Large or long-running jobs: these tools wait for the answer, up to about 5 minutes per call. For many prompts, or for scheduled runs, use the async API (POST /v1/async/task and /v1/async/task/batch, https://cloro.dev/docs) directly instead. It has no sync surcharge and returns results by webhook or polling.

Empty links: a Google result link can come back empty, missing, or as a google.com/goto URL, with a redirectLink beside it. Pass that redirectLink to resolve_google_redirect to get the destination. Do not open a /goto URL yourself.`;

export function buildServer(apiKey: string): McpServer {
  const server = new McpServer(
    {
      name: "cloro",
      version: "0.4.0",
    },
    { instructions: INSTRUCTIONS },
  );

  const client = new CloroClient(apiKey);
  registerMonitorTools(server, client);
  registerReferenceTools(server, client);

  return server;
}
