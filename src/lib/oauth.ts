import { logger } from "./logger";
import { createOAuthTokenVerifier } from "../oauth-tokens";

import { oauth } from "../config";

import type { OAuthTokenVerifier } from "../oauth-tokens";

/**
 * OAuth support for the hosted MCP server.
 *
 * This server is a resource server, not an authorization server — Clerk issues
 * the tokens. Its two jobs are to refuse an unauthenticated call in the exact
 * shape the MCP spec defines, and to reject a bad token here rather than
 * forwarding it to the API and having to translate an upstream failure back
 * into a transport-level 401 from inside a tool handler.
 *
 * Verification is signature-only against Clerk's public JWKS, so this app
 * still holds no secret.
 */

let cached: OAuthTokenVerifier | null | undefined;

export function getOAuthVerifier(): OAuthTokenVerifier | null {
  if (cached !== undefined) return cached;

  const issuer = oauth.issuer;
  if (!issuer) {
    cached = null;
    return cached;
  }

  try {
    cached = createOAuthTokenVerifier({
      issuer,
      jwksUrl: oauth.jwksUrl,
      audience: oauth.resourceUri,
    });
  } catch (error) {
    // A malformed issuer or JWKS URL disables OAuth rather than crashing the
    // first request that carries a token.
    logger.error(
      "OAuth disabled: CLERK_ISSUER / CLERK_JWKS_URL is not a valid URL",
      "MCP",
      { issuer, jwksUrl: oauth.jwksUrl },
      error,
    );
    cached = null;
  }
  return cached;
}

/** Test seam. */
export function resetOAuthVerifier(): void {
  cached = undefined;
}

/**
 * The `WWW-Authenticate` challenge that turns a refusal into a Connect card.
 *
 * A 200 wrapping `isError: true` is an application-level tool failure: the
 * client hands the text to the model and moves on, with no authorization
 * prompt. Only a transport-level 401 carrying this header makes a client stop,
 * run the OAuth flow, and retry the call.
 *
 * `error` is always `invalid_token`. RFC 6750 section 3.1 registers exactly
 * three codes (`invalid_request`, `invalid_token`, `insufficient_scope`) and a
 * client is entitled to key its re-authentication on them; a custom code such
 * as `wrong_audience` is a spec violation that a strict client may treat as
 * terminal. Every failure this server can name — expired, wrong audience, no
 * organization — is cured the same way, by running the flow again, so they
 * share the code and differ only in `error_description`.
 */
export function buildChallenge(
  description = "Authentication required for this tool",
): string {
  const params = [
    `error="invalid_token"`,
    `error_description="${description.replace(/"/g, "'")}"`,
    `resource_metadata="${oauth.resourceMetadataUrl}"`,
  ];
  const scopes = oauth.scopes;
  if (scopes.length > 0) {
    params.push(`scope="${scopes.join(" ")}"`);
  }
  return `Bearer ${params.join(", ")}`;
}
