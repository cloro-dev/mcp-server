/**
 * The canonical resource URI (RFC 8707) of the hosted MCP server, and so the
 * `aud` every access token must carry. Fixed rather than configured: the API
 * accepts tokens for exactly one resource server, and having two services
 * read it from two env vars is how they drift apart.
 */
export const MCP_RESOURCE_URI = "https://mcp.cloro.dev/mcp";
