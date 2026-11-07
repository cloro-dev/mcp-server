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
  "scrape_google_ai_mode",
  "scrape_bing_aimode",
  "scrape_google",
  "scrape_google_news",
  "resolve_google_redirect",
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
      // Monitor tools hit live external engines and re-charge on every
      // call; reference lookups read fixed lists and are free to repeat.
      const isReference = tool.name.startsWith("list_");
      expect(tool.annotations?.openWorldHint, tool.name).toBe(!isReference);
      expect(tool.annotations?.idempotentHint, tool.name).toBe(
        isReference ? true : undefined,
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
      const isReference = tool.name.startsWith("list_");
      expect(Boolean(tool.outputSchema), tool.name).toBe(isReference);
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
      "scrape_bing_aimode",
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

  it("advertises only the markdown and html include flags on scrape_bing_aimode", () => {
    const tool = tools.find((t) => t.name === "scrape_bing_aimode")!;
    const includeProps = tool.inputSchema.properties?.include?.properties;
    expect(Object.keys(includeProps ?? {}).sort()).toEqual(["html", "markdown"]);
    expect(Object.keys(tool.inputSchema.properties ?? {})).toContain("state");
  });

  it("forwards scrape_bing_aimode to /v1/monitor/bing/aimode", async () => {
    const mock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            result: { text: "answer", sources: [], citationPills: [] },
          }),
          {
            status: 200,
            headers: { "X-Credits-Charged": "6", "X-Credits-Remaining": "94" },
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", mock);

    const args = {
      prompt: "best running shoes",
      country: "US",
      include: { markdown: true },
    };
    const result = (await client.callTool({
      name: "scrape_bing_aimode",
      arguments: args,
    })) as CallToolResult;

    const [url, init] = mock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/v1/monitor/bing/aimode");
    expect(JSON.parse(init.body as string)).toEqual(args);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      result: { text: "answer", sources: [], citationPills: [] },
      credits: { charged: 6, remaining: 94 },
    });
  });

  // The limit applies after URL encoding, so 3,500 plain characters pass and
  // 1,000 CJK characters (9 encoded characters each) do not.
  it("rejects a scrape_bing_aimode prompt that is too long after URL encoding", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);

    const result = (await client.callTool({
      name: "scrape_bing_aimode",
      arguments: { prompt: "中".repeat(1_000), country: "US" },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain(
      "Prompt is too long",
    );
    expect(mock).not.toHaveBeenCalled();
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
        args: { model: "gemini" },
        expected: "/v1/countries?model=gemini",
      },
      {
        name: "list_countries",
        args: { model: "bing_aimode" },
        expected: "/v1/countries?model=bing_aimode",
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
      ...COUNTRY_MODELS.filter(
        (model) => !["grok", "copilot", "perplexity"].includes(model),
      ).map((model) => ({
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

  it("does not offer grok, copilot or perplexity to list_countries", async () => {
    for (const model of ["grok", "copilot", "perplexity"]) {
      const result = (await client.callTool({
        name: "list_countries",
        arguments: { model },
      })) as CallToolResult;
      expect(result.isError, model).toBe(true);
    }
  });

  it("states the credit cost in every monitor tool description", async () => {
    const { tools: listed } = await client.listTools();
    for (const tool of listed) {
      if (tool.name.startsWith("list_")) continue;
      expect(tool.description, tool.name).toMatch(/Costs \d+ credits?/);
    }
  });

  it("resolves a redirect link through /v1/monitor/google/goto", async () => {
    const mock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ url: "https://example.com/" }), {
          status: 200,
          headers: { "X-Credits-Charged": "1", "X-Credits-Remaining": "99" },
        }),
      ),
    );
    vi.stubGlobal("fetch", mock);

    const result = (await client.callTool({
      name: "resolve_google_redirect",
      arguments: { url: "https://www.google.com/goto?url=CAESaAHrOzAV" },
    })) as CallToolResult;

    const [url, init] = mock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/v1/monitor/google/goto");
    expect(JSON.parse(init.body as string)).toEqual({
      url: "https://www.google.com/goto?url=CAESaAHrOzAV",
    });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      result: { url: "https://example.com/" },
      credits: { charged: 1, remaining: 99 },
    });
  });

  it("sends server instructions that cover costs, async and empty links", () => {
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("sync surcharge");
    expect(instructions).toContain("/v1/async/task");
    expect(instructions).toContain("resolve_google_redirect");
    expect(instructions).toContain("Bing AI Mode");
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
