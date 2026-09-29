import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import {
  CLOCK_TOLERANCE,
  classifyVerifyError,
  type VerifyFailure,
} from "./classify";

/**
 * Verifies OAuth 2.1 access tokens minted by the cloro Clerk instance.
 *
 * Two services need this and they must agree: apps/mcp verifies so it can
 * answer an unauthenticated `tools/call` with a spec-shaped 401 challenge
 * instead of forwarding a bad token, and apps/api verifies because it is the
 * internet-facing resource server that actually spends credits. A single
 * implementation keeps the two from drifting into disagreeing about what a
 * valid token is.
 *
 * Verification is signature-based against the instance JWKS, which is public.
 * That is the reason this package needs no Clerk secret key, and the reason
 * apps/mcp can stay secretless.
 */

/** The `org_id` claim that carries the organization the user consented for. */
const ORGANIZATION_CLAIM = "org_id";

export interface OAuthPrincipal {
  /** Clerk user id — `User.id` in the cloro schema. */
  userId: string;
  /** Clerk organization id — `Organization.id` in the cloro schema. */
  organizationId: string;
  scopes: string[];
  clientId?: string;
}

export type OAuthTokenFailure =
  | VerifyFailure
  | "wrong_audience"
  | "missing_organization";

export type OAuthVerifyResult =
  | { ok: true; principal: OAuthPrincipal }
  | { ok: false; reason: OAuthTokenFailure };

export interface OAuthVerifierConfig {
  /** Clerk Frontend API issuer, e.g. https://clerk.cloro.dev */
  issuer: string;
  /** JWKS endpoint. Defaults to `<issuer>/.well-known/jwks.json`. */
  jwksUrl?: string;
  /**
   * Canonical resource URI this token must have been minted for
   * (RFC 8707), e.g. https://mcp.cloro.dev/mcp.
   *
   * When set, the token must carry a matching `aud` claim — a token with no
   * `aud` at all is rejected. Clerk writes the `resource` parameter into
   * `aud` verbatim once `aud_claim_enabled` is on for the instance (verified
   * against a real token from the dev instance), so an absent claim means
   * the instance is misconfigured, not that the token is fine. Failing
   * closed there is the point: the MCP spec requires a resource server to
   * accept only tokens issued for it.
   */
  audience?: string;
}

function toScopes(payload: JWTPayload): string[] {
  const scope = payload.scope;
  if (typeof scope === "string") {
    return scope.split(" ").filter(Boolean);
  }
  // Some authorization servers emit the plural array form instead.
  if (Array.isArray(payload.scopes)) {
    return payload.scopes.filter((s): s is string => typeof s === "string");
  }
  return [];
}

function audienceMatches(aud: JWTPayload["aud"], expected: string): boolean {
  if (typeof aud === "string") return aud === expected;
  if (Array.isArray(aud)) return aud.includes(expected);
  return false;
}

export type OAuthTokenVerifier = (token: string) => Promise<OAuthVerifyResult>;

export function createOAuthTokenVerifier(
  config: OAuthVerifierConfig,
): OAuthTokenVerifier {
  const issuer = config.issuer.replace(/\/$/, "");
  const jwksUrl = config.jwksUrl ?? `${issuer}/.well-known/jwks.json`;

  // createRemoteJWKSet caches keys and refetches on an unknown `kid`, so key
  // rotation needs no redeploy and the happy path makes no network call.
  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  return async function verifyOAuthToken(
    token: string,
  ): Promise<OAuthVerifyResult> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer,
        clockTolerance: CLOCK_TOLERANCE,
      }));
    } catch (error) {
      return { ok: false, reason: classifyVerifyError(error) };
    }

    if (config.audience && !audienceMatches(payload.aud, config.audience)) {
      return { ok: false, reason: "wrong_audience" };
    }

    const userId = payload.sub;
    if (typeof userId !== "string" || !userId) {
      return { ok: false, reason: "malformed" };
    }

    // No org_id means the user never granted `user:org:read`, or granted it
    // without picking an organization. Either way there is no account to
    // charge, so the token cannot authorize a scrape.
    const organizationId = payload[ORGANIZATION_CLAIM];
    if (typeof organizationId !== "string" || !organizationId) {
      return { ok: false, reason: "missing_organization" };
    }

    const clientId = payload.client_id;

    return {
      ok: true,
      principal: {
        userId,
        organizationId,
        scopes: toScopes(payload),
        clientId: typeof clientId === "string" ? clientId : undefined,
      },
    };
  };
}
