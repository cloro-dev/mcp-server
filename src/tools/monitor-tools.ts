import {
  aimodeSchema,
  chatgptSchema,
  copilotSchema,
  geminiSchema,
  googleNewsSchema,
  googleSchema,
  grokSchema,
  perplexitySchema,
} from "../schemas";
import { z } from "zod";

import { BASE_READ_ONLY_ANNOTATIONS } from "../lib/annotations";
import { describeFields } from "../lib/describe-fields";
import { observeToolCall } from "../lib/metrics";
import { toolResult } from "../lib/tool-result";

import type { CloroClient } from "../lib/cloro-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const COUNTRY_DOC =
  'ISO 3166-1 alpha-2 country code to geo-target the request from (e.g. "US"). Use list_countries to see supported codes per model.';
const STATE_DOC =
  'Optional state code for state-level targeting (e.g. "CA" when country is "US"). Only some countries support this — call list_states for the supported countries and their codes.';
const INCLUDE_DOC =
  "Optional flags for heavier payload fields, each off by default: markdown (the answer rendered as markdown), html (the answer page HTML), rawResponse (the engine's unprocessed response payload). Leave unset for the leanest response.";
const CHATGPT_INCLUDE_DOC =
  "Optional flags for heavier payload fields, each off by default: markdown (the answer rendered as markdown), html (the answer page HTML), rawResponse (the engine's unprocessed response payload), searchQueries (the web searches ChatGPT issued while answering), ads and shopping (sponsored and product results; these render only on the desktop UI, so pair them with legacy: true). Leave unset for the leanest response.";
const CHATGPT_LEGACY_DOC =
  "Serve ChatGPT's desktop UI instead of the default mobile-web UI. Needed for include.ads and include.shopping, which only render on desktop. Defaults to false.";

const promptDoc = (engine: string) => `The prompt to submit to ${engine}.`;
const QUERY_DOC = "The search query.";
const LOCATION_DOC =
  'Optional location name to target search results (e.g. "Austin, Texas, United States"). Mutually exclusive with uule.';
const UULE_DOC =
  "Optional Google UULE location parameter. Mutually exclusive with location.";
const HL_DOC =
  'Optional Google interface-language code, sent as hl (e.g. "de", "pt-br"). Defaults to the language derived from gl — set it when the geography\'s dominant language is not the one you want.';
const GL_DOC =
  'ISO 3166-1 alpha-2 code for the result geography, sent to Google as gl (e.g. "us"). Use list_countries to see supported codes per model.';
// Only the Google-family tools deprecate `country`; the prompt engines still
// take it as their only geo field, so they keep COUNTRY_DOC unchanged.
const GOOGLE_COUNTRY_DOC =
  COUNTRY_DOC +
  " Deprecated — use gl instead; country is kept for compatibility and must not disagree with gl.";
const DEVICE_DOC = "Device type to emulate. Defaults to desktop.";
const GOOGLE_DEVICE_DOC =
  "Device to emulate: desktop, mobile, ios (Safari on iPhone), or android (Chrome on Android). mobile is an alias for android. Defaults to desktop.";
const PAGES_DOC = "Number of result pages to fetch (1-10). Defaults to 1.";

interface MonitorTool {
  name: string;
  path: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
}

// Every scrape tool reads from a live external engine, hence `openWorldHint`.
// Not idempotent: each call re-scrapes and charges credits again.
const SCRAPE_ANNOTATIONS = {
  ...BASE_READ_ONLY_ANNOTATIONS,
  openWorldHint: true,
} as const;

// Passing a raw `.shape` to the SDK drops the schemas' cross-field
// superRefine checks (state requires country "US", query/url exclusivity),
// so those arrive as API validation errors rather than client-side ones.

/** The five prompt-in/answer-out engines share everything but the engine name. */
const promptEngineTool = (tool: {
  name: string;
  path: string;
  title: string;
  engine: string;
  shape: z.ZodRawShape;
  description?: string;
  extraDocs?: Record<string, string>;
}): MonitorTool => ({
  name: tool.name,
  path: tool.path,
  title: tool.title,
  description:
    tool.description ??
    `Submit a prompt to ${tool.engine} from a chosen country (and optionally US state) and return the answer with cited sources. Use this to see how ${tool.engine} answers a prompt and which brands/sources it mentions.`,
  inputSchema: describeFields(tool.shape, {
    prompt: promptDoc(tool.engine),
    country: COUNTRY_DOC,
    state: STATE_DOC,
    include: INCLUDE_DOC,
    ...tool.extraDocs,
  }),
});

const MONITOR_TOOLS: MonitorTool[] = [
  promptEngineTool({
    name: "scrape_chatgpt",
    path: "/v1/monitor/chatgpt",
    title: "Scrape ChatGPT",
    engine: "ChatGPT",
    description:
      "Submit a prompt to ChatGPT from a chosen country (and optionally US state) and return the full answer: text, cited sources, and optionally markdown, search queries, shopping results, and ads. Use this to see how ChatGPT answers a prompt and which brands/sources it mentions.",
    shape: chatgptSchema.shape,
    extraDocs: { include: CHATGPT_INCLUDE_DOC, legacy: CHATGPT_LEGACY_DOC },
  }),
  promptEngineTool({
    name: "scrape_gemini",
    path: "/v1/monitor/gemini",
    title: "Scrape Google Gemini",
    engine: "Google Gemini",
    shape: geminiSchema.shape,
  }),
  promptEngineTool({
    name: "scrape_copilot",
    path: "/v1/monitor/copilot",
    title: "Scrape Microsoft Copilot",
    engine: "Microsoft Copilot",
    shape: copilotSchema.shape,
  }),
  promptEngineTool({
    name: "scrape_perplexity",
    path: "/v1/monitor/perplexity",
    title: "Scrape Perplexity",
    engine: "Perplexity",
    shape: perplexitySchema.shape,
  }),
  promptEngineTool({
    name: "scrape_grok",
    path: "/v1/monitor/grok",
    title: "Scrape Grok",
    engine: "Grok (xAI)",
    shape: grokSchema.shape,
  }),
  {
    name: "scrape_google_ai_mode",
    path: "/v1/monitor/aimode",
    title: "Scrape Google AI Mode",
    description:
      "Submit a prompt to Google AI Mode from a chosen country and return the AI answer with cited sources. Supports location or UULE targeting and desktop/mobile emulation.",
    // aimodeSchema is a ZodPipe (object -> transform) since geo
    // normalization; the tool advertises the pipe's input object.
    inputSchema: describeFields(aimodeSchema.in.shape, {
      prompt: promptDoc("Google AI Mode"),
      country: GOOGLE_COUNTRY_DOC,
      gl: GL_DOC,
      hl: HL_DOC,
      location: LOCATION_DOC,
      uule: UULE_DOC,
      device: DEVICE_DOC,
      include: INCLUDE_DOC,
    }),
  },
  {
    name: "scrape_google",
    path: "/v1/monitor/google",
    title: "Scrape Google Search",
    description:
      "Run a Google search from a chosen country and return organic results, with optional AI Overview extraction (include.aioverview) and People-Also-Ask AI answers (include.paaAioverview). Two modes: structured (query + country, with optional location/uule/pages) or url (a complete google.com/search URL that owns query, location, and pagination). Supports desktop, mobile, iOS, and Android emulation and multi-page results.",
    // googleSchema is a ZodPipe (object -> transform) since url-mode
    // decomposition (ENG-536); the tool advertises the pipe's input object.
    inputSchema: describeFields(googleSchema.in.shape, {
      query: "The search query. Required unless url is provided.",
      url: "A complete google.com/search URL to fetch instead of building one from structured fields. When set, query/location/uule/pages must be omitted (the URL owns them); gl and hl are read from the URL's gl/hl parameters; an explicit gl or hl must agree with the URL's copy.",
      country: GOOGLE_COUNTRY_DOC,
      gl:
        GL_DOC +
        " Required in query mode; in url mode it is read from the URL's gl parameter unless supplied here, and an explicit value wins.",
      hl:
        HL_DOC +
        " In url mode it is read from the URL's hl parameter unless supplied here, and an explicit value wins.",
      location: LOCATION_DOC,
      uule: UULE_DOC,
      device: GOOGLE_DEVICE_DOC,
      pages: PAGES_DOC,
      include:
        "Optional flags. Set aioverview: true to extract Google's AI Overview (or { markdown: true } for markdown), paaAioverview: true to hydrate AI answers in People Also Ask. Leave unset for organic results only.",
    }),
  },
  {
    name: "scrape_google_news",
    path: "/v1/monitor/google/news",
    title: "Scrape Google News",
    description:
      "Run a Google News search from a chosen country and return news results. Supports desktop, mobile, iOS, and Android emulation and multi-page results.",
    // googleNewsSchema is a ZodPipe (object -> transform) since geo
    // normalization; the tool advertises the pipe's input object.
    inputSchema: describeFields(googleNewsSchema.in.shape, {
      query: QUERY_DOC,
      country: GOOGLE_COUNTRY_DOC,
      gl: GL_DOC,
      hl: HL_DOC,
      device: GOOGLE_DEVICE_DOC,
      pages: PAGES_DOC,
      include: INCLUDE_DOC,
    }),
  },
];

export function registerMonitorTools(
  server: McpServer,
  client: CloroClient,
): void {
  for (const tool of MONITOR_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: SCRAPE_ANNOTATIONS,
      },
      (args: Record<string, unknown>) =>
        observeToolCall(tool.name, async () => {
          const { body, credits } = await client.post(tool.path, args);
          const result = (body as { result?: unknown })?.result ?? body;
          return toolResult({ result, credits });
        }),
    );
  }
}
