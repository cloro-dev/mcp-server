import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
} from "jose";

import {
  CLOCK_TOLERANCE,
  classifyVerifyError,
  type VerifyFailure,
} from "./classify";

/**
 * Verifies Clerk *session* tokens — the credential the dashboard already
 * holds for the signed-in user.
 *
 * The playground sends monitor requests as the user rather than with an API
 * key (ENG-989): keys are stored only as hashes, so the dashboard cannot send
 * one on the user's behalf. Verification is the same JWKS signature check the
 * OAuth verifier does, so this needs no Clerk secret either.
 *
 * A session token is not an OAuth access token and the two cannot share a
 * verifier: a session token carries no `aud`, and the organization is in the
 * `o.id` claim on version 2 tokens rather than `org_id`.
 */

/** Session token v2 nests the organization; version 1 used `org_id`. */
interface OrganizationClaimV2 {
  id?: unknown;
}

export interface SessionPrincipal {
  /** Clerk user id — `User.id` in the cloro schema. */
  userId: string;
  /** Clerk organization id — `Organization.id` in the cloro schema. */
  organizationId: string;
  /** Clerk session id. */
  sessionId: string;
}

export type SessionTokenFailure = VerifyFailure | "missing_organization";

export type SessionVerifyResult =
  | { ok: true; principal: SessionPrincipal }
  | { ok: false; reason: SessionTokenFailure };

export interface SessionVerifierConfig {
  /** Clerk Frontend API issuer, e.g. https://clerk.cloro.dev */
  issuer: string;
  /** JWKS endpoint. Defaults to `<issuer>/.well-known/jwks.json`. */
  jwksUrl?: string;
}

export type SessionTokenVerifier = (
  token: string,
) => Promise<SessionVerifyResult>;

/**
 * Tells a session token from an OAuth access token, so the caller knows which
 * verifier to run. Only a session token carries `sid`.
 *
 * This reads the payload without checking the signature, which is safe
 * because it only routes: whichever verifier runs still rejects a token it
 * does not trust.
 */
export function looksLikeSessionToken(token: string): boolean {
  try {
    return typeof decodeJwt(token).sid === "string";
  } catch {
    return false;
  }
}

function organizationId(payload: JWTPayload): string | null {
  const nested = (payload.o as OrganizationClaimV2 | undefined)?.id;
  if (typeof nested === "string" && nested) return nested;
  if (typeof payload.org_id === "string" && payload.org_id) {
    return payload.org_id;
  }
  return null;
}

export function createSessionTokenVerifier(
  config: SessionVerifierConfig,
): SessionTokenVerifier {
  const issuer = config.issuer.replace(/\/$/, "");
  const jwksUrl = config.jwksUrl ?? `${issuer}/.well-known/jwks.json`;

  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  return async function verifySessionToken(
    token: string,
  ): Promise<SessionVerifyResult> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer,
        clockTolerance: CLOCK_TOLERANCE,
      }));
    } catch (error) {
      return { ok: false, reason: classifyVerifyError(error) };
    }

    const userId = payload.sub;
    const sessionId = payload.sid;
    if (
      typeof userId !== "string" ||
      !userId ||
      typeof sessionId !== "string" ||
      !sessionId
    ) {
      return { ok: false, reason: "malformed" };
    }

    // No organization means the user has none active in the dashboard, so
    // there is no account to charge.
    const organization = organizationId(payload);
    if (!organization) {
      return { ok: false, reason: "missing_organization" };
    }

    return {
      ok: true,
      principal: { userId, organizationId: organization, sessionId },
    };
  };
}
