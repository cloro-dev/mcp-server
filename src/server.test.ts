import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ALL_COUNTRY_CODES,
  availableStates,
  COUNTRY_MODELS,
  MODEL_COUNTRIES,
  STATE_COUNTRIES,
} from "./schemas";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildServer } from "./server";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const EXPECTED_TOOLS = [
  "scrape_chatgpt",
  "scrape_gemini",
  "scrape_copilot",
  "scrape_perplexity",
  "scrape_grok",
  "scrape_google_ai_mode",
  "scrape_google",
  "scrape_google_news",
  "list_countries",
  "list_states",
];

type ToolSchema = {
  required?: string[];
  properties?: Record<string, { properties?: Record<string, unknown> }>;
};

type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

describe("cloro MCP server", () => {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  let tools: Array<{
    name: string;
    title?: string;
    inputSchema: ToolSchema;
    outputSchema?: ToolSchema;
    annotations?: ToolAnnotations;
    _meta?: { securitySchemes?: unknown };
  }>;

  beforeAll(async () => {
    const server = buildServer("sk_test_key");
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    tools = (await client.listTools()).tools as typeof tools;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers exactly the expected tools", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  // The Anthropic Connectors Directory rejects tools missing a title and the
  // applicable readOnlyHint/destructiveHint; the OpenAI plugin review also
  // reads openWorldHint. Losing these silently fails a directory submission.
  it("annotates every tool as read-only with a title", () => {
    for (const tool of tools) {
      // Spec-canonical location; Tool.title takes precedence over the legacy
      // annotations.title, and the SDK emits only the former.
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
      // Scrapes hit live external engines and re-charge on every call;
      // reference lookups read fixed lists and are free to repeat.
      const isScrape = tool.name.startsWith("scrape_");
      expect(tool.annotations?.openWorldHint, tool.name).toBe(isScrape);
      expect(tool.annotations?.idempotentHint, tool.name).toBe(
        isScrape ? undefined : true,
      );
    }
  });

  it("declares OAuth securitySchemes on every tool", () => {
    for (const tool of tools) {
      expect(tool._meta?.securitySchemes, tool.name).toEqual([
        { type: "oauth2", scopes: ["profile", "email", "user:org:read"] },
      ]);
    }
  });

  // A declared outputSchema makes the SDK fail any call whose result does not
  // conform, so only the tools with a fixed response shape declare one.
  it("declares an outputSchema only on the reference tools", () => {
    for (const tool of tools) {
      const isScrape = tool.name.startsWith("scrape_");
      expect(Boolean(tool.outputSchema), tool.name).toBe(!isScrape);
    }
  });

  // The third copy of the version. server-json.test.ts pins server.json
  // against package.json; this pins the running server against server.json,
  // so all three move together or the suite fails.
  it("reports the version declared in server.json", () => {
    const { version } = JSON.parse(
      readFileSync(new URL("../server.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(client.getServerVersion()?.version).toBe(version);
  });

  it("requires prompt and country on the prompt-engine tools", () => {
    for (const name of [
      "scrape_chatgpt",
      "scrape_gemini",
      "scrape_copilot",
      "scrape_perplexity",
      "scrape_grok",
    ]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.inputSchema.required).toEqual(
        expect.arrayContaining(["prompt", "country"]),
      );
    }
  });

  it("offers hl and gl on the Google-family tools", () => {
    for (const name of [
      "scrape_google",
      "scrape_google_news",
      "scrape_google_ai_mode",
    ]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(
        expect.arrayContaining(["hl", "gl", "country"]),
      );
      // `country` is the deprecated alias for `gl`, so neither is required on
      // its own — the schema's cross-field rule enforces that one is present.
      expect(tool.inputSchema.required ?? []).not.toContain("country");
      expect(tool.inputSchema.required ?? []).not.toContain("gl");
    }
  });

  it("keeps scrape_google's fields optional for query/url dual mode", () => {
    const tool = tools.find((t) => t.name === "scrape_google")!;
    expect(tool.inputSchema.required ?? []).toEqual([]);
  });

  it("advertises scrape_google's public include flags", () => {
    const tool = tools.find((t) => t.name === "scrape_google")!;
    const includeProps = tool.inputSchema.properties?.include?.properties;
    expect(includeProps).toBeDefined();
    expect(Object.keys(includeProps!)).toEqual(
      expect.arrayContaining(["html", "aioverview", "paaAioverview"]),
    );
  });

  it("forwards tool calls to the API and returns result + credits", async () => {
    const mock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ success: true, result: { text: "answer" } }),
          {
            status: 200,
            headers: {
              "X-Credits-Charged": "7",
              "X-Credits-Remaining": "93",
            },
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", mock);

    const result = (await client.callTool({
      name: "scrape_chatgpt",
      arguments: { prompt: "hello", country: "US" },
    })) as CallToolResult;

    const [url, init] = mock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toContain("/v1/monitor/chatgpt");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk_test_key",
    );

    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      result: { text: "answer" },
      credits: { charged: 7, remaining: 93 },
    });
  });

  it("calls the reference endpoints with the query params the API requires", async () => {
    const cases = [
      {
        name: "list_states",
        args: { country: "US" },
        expected: "/v1/states?country=US",
      },
      { name: "list_countries", args: {}, expected: "/v1/countries" },
      {
        name: "list_countries",
        args: { model: "grok" },
        expected: "/v1/countries?model=grok",
      },
    ];

    for (const { name, args, expected } of cases) {
      const mock = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify([]), { status: 200 })),
      );
      vi.stubGlobal("fetch", mock);

      const result = (await client.callTool({
        name,
        arguments: args,
      })) as CallToolResult;

      const [url] = mock.mock.calls[0] as unknown as [URL];
      expect(`${url.pathname}${url.search}`).toBe(expected);
      expect(result.isError).toBeFalsy();
    }
  });

  // Feeds each tool the exact response the API sends for every input it
  // accepts. The SDK checks structuredContent against the outputSchema on the
  // server and again on the client, so a mismatch rejects the call.
  it("returns reference results that conform to their outputSchema", async () => {
    const cases = [
      {
        name: "list_countries",
        args: {},
        body: ALL_COUNTRY_CODES,
        expected: { countries: ALL_COUNTRY_CODES },
      },
      ...COUNTRY_MODELS.map((model) => ({
        name: "list_countries",
        args: { model },
        body: MODEL_COUNTRIES[model],
        expected: { countries: MODEL_COUNTRIES[model] },
      })),
      ...STATE_COUNTRIES.map((country) => ({
        name: "list_states",
        args: { country },
        body: availableStates(country),
        expected: { states: availableStates(country) },
      })),
    ];

    for (const { name, args, body, expected } of cases) {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
        ),
      );

      const result = (await client.callTool({
        name,
        arguments: args,
      })) as CallToolResult;

      expect(result.isError, `${name} ${JSON.stringify(args)}`).toBeFalsy();
      expect(result.structuredContent).toEqual(expected);
      expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(
        expected,
      );
    }
  });

  it("returns API errors as tool errors with the envelope details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              success: false,
              error: {
                code: "INSUFFICIENT_CREDITS",
                message: "Not enough credits",
              },
            }),
            { status: 402 },
          ),
        ),
      ),
    );

    const result = (await client.callTool({
      name: "scrape_chatgpt",
      arguments: { prompt: "hello", country: "US" },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain(
      "INSUFFICIENT_CREDITS",
    );
  });

});
