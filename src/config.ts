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

/**
 * OAuth settings, read on access rather than at import.
 *
 * Everything above is fixed for the life of the process. These are not: the
 * tests flip `CLERK_ISSUER` to exercise both the configured and unconfigured
 * server, and freezing them at import would make that impossible without
 * module-registry games.
 *
 * Clerk is the authorization server. `CLERK_ISSUER` unset disables the OAuth
 * branch entirely — the protected resource metadata advertises no
 * authorization server and API keys stay the only credential — which is what
 * makes this deployable ahead of the Clerk configuration.
 */
export const oauth = {
  /** Public origin this server is reached at. */
  get publicUrl(): string {
    return (process.env.MCP_PUBLIC_URL || "https://mcp.cloro.dev").replace(
      /\/$/,
      "",
    );
  },

  get issuer(): string | undefined {
    return process.env.CLERK_ISSUER;
  },

  get jwksUrl(): string | undefined {
    return process.env.CLERK_JWKS_URL;
  },

  /**
   * Scopes named in the 401 challenge. `user:org:read` is the load-bearing
   * one: it puts the organization picker on Clerk's consent screen and is what
   * makes the token carry the `org_id` claim the API resolves an organization
   * from. Without it a token verifies but can charge nobody.
   */
  get scopes(): string[] {
    return (process.env.MCP_OAUTH_SCOPES || "profile email user:org:read")
      .split(" ")
      .filter(Boolean);
  },

  /**
   * The canonical resource URI (RFC 8707). The spec requires this to match the
   * URL the user enters in their client exactly, so it is built from the
   * public origin and not from the listen address.
   */
  get resourceUri(): string {
    return `${this.publicUrl}/mcp`;
  },

  /** Where the RFC 9728 document lives, for the 401 `resource_metadata` hint. */
  get resourceMetadataUrl(): string {
    return `${this.publicUrl}/.well-known/oauth-protected-resource/mcp`;
  },

  get enabled(): boolean {
    return Boolean(this.issuer);
  },
};
