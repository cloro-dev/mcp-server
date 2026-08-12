import { COUNTRY_MODELS, STATE_COUNTRIES } from "../schemas";
import { z } from "zod";

import { BASE_READ_ONLY_ANNOTATIONS } from "../lib/annotations";
import { observeToolCall } from "../lib/metrics";
import { toolResult } from "../lib/tool-result";

import type { CloroClient } from "../lib/cloro-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Both tools read cloro's own fixed reference lists: no external entities, and
// repeat calls return the same data without charging credits.
const REFERENCE_ANNOTATIONS = {
  ...BASE_READ_ONLY_ANNOTATIONS,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerReferenceTools(
  server: McpServer,
  client: CloroClient,
): void {
  server.registerTool(
    "list_countries",
    {
      title: "List supported countries",
      description:
        "List the ISO 3166-1 alpha-2 country codes supported for geo-targeting. Pass a model to get the codes available for that specific engine (some engines block certain countries).",
      inputSchema: {
        model: z
          .enum(COUNTRY_MODELS)
          .optional()
          .describe(
            "Optionally filter to countries supported by a specific engine.",
          ),
      },
      annotations: REFERENCE_ANNOTATIONS,
    },
    ({ model }) =>
      observeToolCall("list_countries", async () => {
        const { body } = await client.get(
          model ? `/v1/countries?model=${model}` : "/v1/countries",
        );
        return toolResult(body);
      }),
  );

  server.registerTool(
    "list_states",
    {
      title: "List states for a country",
      description:
        'List the state codes available for state-level geo-targeting in a country (used as the "state" parameter on the scrape tools). Only countries with state-level targeting are accepted.',
      inputSchema: {
        country: z
          .enum(STATE_COUNTRIES)
          .describe(
            "ISO 3166-1 alpha-2 country code to list states for. Only countries with state-level targeting are supported.",
          ),
      },
      annotations: REFERENCE_ANNOTATIONS,
    },
    ({ country }) =>
      observeToolCall("list_states", async () => {
        const { body } = await client.get(`/v1/states?country=${country}`);
        return toolResult(body);
      }),
  );
}
