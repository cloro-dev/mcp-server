import { afterEach, describe, expect, it, vi } from "vitest";

import { CloroClient } from "./cloro-client";

const client = new CloroClient("sk_test_key");

const stubFetch = (response: Response | Error) => {
  const mock = vi.fn(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
};

const jsonResponse = (
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
) =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: init?.headers,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CloroClient", () => {
  it("sends the API key as a Bearer token", async () => {
    const mock = stubFetch(jsonResponse({ ok: true }));
    await client.get("/v1/countries");

    const [url, init] = mock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toContain("/v1/countries");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk_test_key",
    );
  });

  it("POSTs JSON bodies with a content-type header", async () => {
    const mock = stubFetch(jsonResponse({ ok: true }));
    await client.post("/v1/monitor/chatgpt", { prompt: "hi" });

    const [, init] = mock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    expect(init.body).toBe(JSON.stringify({ prompt: "hi" }));
  });

  it("parses credits when both headers are present", async () => {
    stubFetch(
      jsonResponse(
        { success: true },
        {
          headers: {
            "X-Credits-Charged": "7",
            "X-Credits-Remaining": "93",
          },
        },
      ),
    );
    const { credits } = await client.post("/v1/monitor/chatgpt", {});
    expect(credits).toEqual({ charged: 7, remaining: 93 });
  });

  it("omits credits when the headers are absent", async () => {
    stubFetch(jsonResponse({ success: true }));
    const { credits } = await client.get("/v1/countries");
    expect(credits).toBeUndefined();
  });

  it("omits credits when only one header is present", async () => {
    stubFetch(
      jsonResponse(
        { success: true },
        { headers: { "X-Credits-Charged": "7" } },
      ),
    );
    const { credits } = await client.post("/v1/monitor/chatgpt", {});
    expect(credits).toBeUndefined();
  });

  it("surfaces the API error envelope in thrown errors", async () => {
    stubFetch(
      jsonResponse(
        {
          success: false,
          error: {
            code: "INSUFFICIENT_CREDITS",
            message: "Not enough credits",
            details: { required: 5 },
          },
        },
        { status: 402 },
      ),
    );
    await expect(client.post("/v1/monitor/chatgpt", {})).rejects.toThrow(
      'cloro API error 402 (INSUFFICIENT_CREDITS): Not enough credits — {"required":5}',
    );
  });

  it("handles non-JSON error bodies (e.g. a gateway error page)", async () => {
    stubFetch(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(client.get("/v1/countries")).rejects.toThrow(
      "cloro API error 502: request failed",
    );
  });

  it("maps timeouts to a message pointing at the async API", async () => {
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    stubFetch(timeout);
    await expect(client.post("/v1/monitor/chatgpt", {})).rejects.toThrow(
      /timed out after 320s.*async task API/,
    );
  });

  it("wraps network failures with the requested path", async () => {
    stubFetch(new TypeError("fetch failed"));
    await expect(client.get("/v1/countries")).rejects.toThrow(
      "cloro API request to /v1/countries failed: fetch failed",
    );
  });
});
