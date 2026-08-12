export const config = {
  transport: process.env.MCP_TRANSPORT || "http",
  port: parseInt(process.env.PORT || "8095"),
  apiUrl: process.env.CLORO_API_URL || "https://api.cloro.dev",
  // stdio mode only — the MCP client spawns this process and passes the
  // caller's key via env. Unused (and normally unset) in http mode, where
  // keys arrive per request.
  apiKey: process.env.CLORO_API_KEY,
  // Sync scrapes can take up to 5 minutes server-side; leave headroom on top.
  requestTimeoutMs: 320_000,
};
