import { oauth } from "../config";

/**
 * RFC 9728 protected resource metadata for the hosted MCP server.
 *
 * The MCP authorization spec builds on RFC 9728, and a client may probe this
 * well-known path directly rather than waiting to be pointed at it. That is
 * the reason this document exists and its counterpart on the public API does
 * not: an OpenAPI `securitySchemes.bearerAuth` entry already tells an HTTP
 * client what api.cloro.dev wants, and nothing probes a `.well-known` path
 * for a plain REST API unprompted. MCP has no OpenAPI to carry that.
 *
 * `authorization_servers` names the cloro Clerk instance. A client reads it
 * after a 401, fetches Clerk's RFC 8414 metadata to find `/authorize` and
 * `/token`, and runs the flow from there — nothing about the authorization
 * server is hard-coded in the client. Only the first entry is used, so this
 * stays a single-element list.
 *
 * The document degrades on purpose when `CLERK_ISSUER` is unset: with no
 * authorization server configured there is nothing to point a client at, and
 * advertising one that does not answer is worse than advertising none. API
 * keys keep working either way.
 */
export function buildProtectedResourceMetadata(): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    resource: oauth.resourceUri,
    resource_name: "cloro MCP server",
    resource_documentation: "https://cloro.dev/docs/integrations/mcp",
    bearer_methods_supported: ["header"],
    resource_policy_uri: "https://cloro.dev/privacy/",
    resource_tos_uri: "https://cloro.dev/terms/",
  };

  if (oauth.enabled) {
    metadata.authorization_servers = [oauth.issuer];
    metadata.scopes_supported = oauth.scopes;
  }

  return metadata;
}
