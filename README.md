# cloro MCP Server

The source of the [cloro MCP server](https://cloro.dev/docs/integrations/mcp), which gives any MCP-capable agent tools for querying ChatGPT, Perplexity, Gemini, Copilot, Grok, Google AI Mode, Google Search and Google News. Ask your agent *"check whether ChatGPT recommends us for best SERP API"* and it calls the cloro API and reasons over the parsed answer and its cited sources.

Runs hosted at `mcp.cloro.dev`, or locally over stdio.

## How do you connect an agent to the cloro MCP server?

In Claude, you sign in with OAuth and do not need a key:

1. Go to **Customize → Connectors** and select **Add custom connector**.
2. Enter `https://mcp.cloro.dev/mcp`. Under **Authentication**, choose **Sign in when needed**.
3. Ask Claude to use a cloro tool. Sign in to cloro and select the organization whose credits pay for the calls.

Other clients use a cloro API key from the [dashboard](https://dashboard.cloro.dev). The hosted server speaks Streamable HTTP. Put the key in the URL path so it works in clients that cannot set custom headers:

```json
{
  "mcpServers": {
    "cloro": {
      "type": "http",
      "url": "https://mcp.cloro.dev/YOUR_CLORO_API_KEY/mcp"
    }
  }
}
```

If your client can set headers, use `https://mcp.cloro.dev/mcp` with `Authorization: Bearer YOUR_CLORO_API_KEY`. In Claude Code:

```bash
claude mcp add --transport http cloro https://mcp.cloro.dev/YOUR_CLORO_API_KEY/mcp
```

### In Cursor

This repo is also a Cursor plugin. Install it from the Cursor marketplace, or point Cursor at the repo, and Cursor prompts for one variable:

| Variable | Value |
| --- | --- |
| `CLORO_API_KEY` | Your key from the [dashboard](https://dashboard.cloro.dev) |

Cursor stores the key on its side and sends it as `Authorization: Bearer`, so the key stays out of the URL and out of the repo. The manifest is `.cursor-plugin/plugin.json` and the server definition is `mcp.json`.

### Running it yourself

```bash
npm install
npm run build
MCP_TRANSPORT=stdio CLORO_API_KEY=your_key node dist/index.js
```

`MCP_TRANSPORT` is `http` (default) or `stdio`. In stdio mode the client spawns the process and the key comes from `CLORO_API_KEY`; in http mode keys arrive per request and no key is configured on the server. `PORT` defaults to `8095` and `CLORO_API_URL` to `https://api.cloro.dev`.

OAuth is off unless you set `CLERK_ISSUER`. The hosted server sets it to `https://clerk.cloro.dev`. `api.cloro.dev` accepts only tokens from that issuer, so a self-hosted server that forwards to it must use the same value. `MCP_PUBLIC_URL` (default `https://mcp.cloro.dev`) sets the resource URL in the protected resource metadata.

## What tools does it expose?

| Tool | Endpoint |
| --- | --- |
| `scrape_chatgpt` | [`POST /v1/monitor/chatgpt`](https://cloro.dev/docs/api-reference/endpoint/monitor-chatgpt) |
| `scrape_gemini` | [`POST /v1/monitor/gemini`](https://cloro.dev/docs/api-reference/endpoint/monitor-gemini) |
| `scrape_copilot` | [`POST /v1/monitor/copilot`](https://cloro.dev/docs/api-reference/endpoint/monitor-copilot) |
| `scrape_perplexity` | [`POST /v1/monitor/perplexity`](https://cloro.dev/docs/api-reference/endpoint/monitor-perplexity) |
| `scrape_grok` | [`POST /v1/monitor/grok`](https://cloro.dev/docs/api-reference/endpoint/monitor-grok) |
| `scrape_google_ai_mode` | [`POST /v1/monitor/aimode`](https://cloro.dev/docs/api-reference/endpoint/monitor-aimode) |
| `scrape_google` | [`POST /v1/monitor/google`](https://cloro.dev/docs/api-reference/endpoint/monitor-google) |
| `scrape_google_news` | [`POST /v1/monitor/google/news`](https://cloro.dev/docs/api-reference/endpoint/monitor-google-news) |
| `list_countries` | [`GET /v1/countries`](https://cloro.dev/docs/api-reference/endpoint/countries) |
| `list_states` | [`GET /v1/states`](https://cloro.dev/docs/api-reference/endpoint/states) |

The assistant tools take a `prompt` and a `country` (ISO 3166-1 alpha-2), plus an optional `state` for US state-level targeting. The Google tools take `gl` for the result geography and an optional `hl` for the interface language; `country` still works as a deprecated alias for `gl`. `scrape_google_ai_mode` targets sub-country with `location` or `uule` rather than `state`. `scrape_google` runs either from a `query` plus `gl`, or from a complete `google.com/search` URL that carries the query and pagination itself, and accepts `include.aioverview` for Google's AI Overview. Every tool takes an optional `include` object for heavier payload fields; leave it unset for the leanest response.

`scrape_grok` is registered, but Grok availability varies. Check the [provider status page](https://cloro.dev/docs/guides/providers) before relying on it.

## How it works

The server holds no business logic and no secrets. Each request forwards the caller's own credential, an API key or an OAuth access token, to `api.cloro.dev` as a Bearer token, so authentication, credit billing, rate limiting and concurrency are all enforced by the API rather than here. In http mode every POST builds a fresh server and transport bound to that caller's credential, which is why one deployment serves everyone with no session state.

`initialize` and `tools/list` answer without a credential, so a client can list the tools before sign-in. The first `tools/call` without one returns `401` with a `WWW-Authenticate` header that points at `/.well-known/oauth-protected-resource/mcp`. An OAuth client reads the authorization server from there and runs the flow. The server checks a token's signature against the issuer's public JWKS (code in `src/oauth-tokens/`), so it needs no Clerk secret.

Tool input schemas are the same zod schemas the API validates with, vendored into `src/schemas/` from cloro's backend. They are copied rather than imported because that package is not published. The [API reference](https://cloro.dev/docs/api-reference/introduction) is authoritative if the two ever disagree.

## FAQ

### Do I need to self-host this?

No. `mcp.cloro.dev` is hosted and is the path most people should take. This repo exists so you can read what runs, and self-host if your setup calls for it.

### Does it cost credits?

The scrape tools call billable endpoints, so yes, at the same rate as the API. `list_countries` and `list_states` read fixed reference lists and charge nothing. See [pricing](https://cloro.dev/pricing/).

### Why is my API key in the URL?

Because several MCP clients cannot set custom headers. If yours can, use the `Authorization` header form instead and keep the key out of the path. If your client supports OAuth, use that and there is no key at all. The URL path accepts API keys only, never OAuth tokens.

### What is the request timeout?

320 seconds. Sync scrapes can take up to five minutes server-side, so the client budget leaves headroom. For long-running batches use the [async task API](https://cloro.dev/docs/api-reference/endpoint/create-async-task) rather than MCP.

## Learn more

- **Integration guide:** [cloro.dev/docs/integrations/mcp](https://cloro.dev/docs/integrations/mcp)
- **API reference:** [cloro.dev/docs](https://cloro.dev/docs/api-reference/introduction)

## License

MIT. See [LICENSE](./LICENSE).
