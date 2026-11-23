import { COUNTRY_MODELS, STATE_COUNTRIES } from "../schemas";
import { z } from "zod";

import { BASE_READ_ONLY_ANNOTATIONS, toolMeta } from "../lib/annotations";
import { observeToolCall } from "../lib/metrics";
import { structuredToolResult } from "../lib/tool-result";

import type { CloroClient } from "../lib/cloro-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// These tools read cloro's own data: no external entities, and repeat calls
// charge no credits and change nothing.
const REFERENCE_ANNOTATIONS = {
  ...BASE_READ_ONLY_ANNOTATIONS,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// structuredContent must be an object, and the API returns a bare array, so
// the result wraps the array in one key. The item schemas stay loose
// (string, not an enum of codes): a stricter schema than the API response
// makes the SDK fail the call.
const COUNTRIES_OUTPUT = {
  countries: z.array(z.string()).describe("ISO 3166-1 alpha-2 country codes."),
};
const STATES_OUTPUT = {
  states: z
    .array(z.object({ code: z.string(), name: z.string() }))
    .describe("States available for state-level targeting."),
};
// GET /v1/credits (apps/api/src/controllers/v1/fetch-credits.ts). The balance
// changes between calls, but a read charges nothing and changes nothing, so
// the tool keeps the reference annotations.
const CREDITS_OUTPUT = {
  remaining: z.number().describe("Credits left in the organization."),
  perCycle: z
    .number()
    .nullable()
    .describe("Credits granted per billing cycle. Null on the free tier."),
  cycleResetsAt: z
    .string()
    .nullable()
    .describe(
      "When the billing cycle ends and the credits reset (ISO 8601). Null on the free tier.",
    ),
};

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
        // The API still accepts these models. MCP excludes them because cloro
        // stopped Grok (MAR-401), Copilot and Perplexity (OPE-203).
        model: z
          .enum(COUNTRY_MODELS)
          .exclude(["grok", "copilot", "perplexity"])
          .optional()
          .describe(
            "Optionally filter to countries supported by a specific engine.",
          ),
      },
      outputSchema: COUNTRIES_OUTPUT,
      annotations: REFERENCE_ANNOTATIONS,
      _meta: toolMeta(),
    },
    ({ model }) =>
      observeToolCall("list_countries", async () => {
        const { body } = await client.get(
          model ? `/v1/countries?model=${model}` : "/v1/countries",
        );
        return structuredToolResult({ countries: body as string[] });
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
      outputSchema: STATES_OUTPUT,
      annotations: REFERENCE_ANNOTATIONS,
      _meta: toolMeta(),
    },
    ({ country }) =>
      observeToolCall("list_states", async () => {
        const { body } = await client.get(`/v1/states?country=${country}`);
        return structuredToolResult({
          states: body as Array<{ code: string; name: string }>,
        });
      }),
  );

  server.registerTool(
    "get_credits",
    {
      title: "Get the credit balance",
      description:
        "Get the organization's credit balance: credits remaining, credits per billing cycle, and when the cycle resets. Free. Call it before a large run to check that the credits cover it. The balance can lag by up to 60 seconds.",
      inputSchema: {},
      outputSchema: CREDITS_OUTPUT,
      annotations: REFERENCE_ANNOTATIONS,
      _meta: toolMeta(),
    },
    () =>
      observeToolCall("get_credits", async () => {
        const { body } = await client.get("/v1/credits");
        return structuredToolResult(
          body as {
            remaining: number;
            perCycle: number | null;
            cycleResetsAt: string | null;
          },
        );
      }),
  );
}
