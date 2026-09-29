/**
 * Both verifiers in this package do the same JWKS signature check, so they
 * fail in the same ways and say so with the same words.
 */

/**
 * Skew allowed on `exp` / `nbf`. Clerk session tokens live 60 seconds and
 * carry `nbf`, so a pod whose clock lags Clerk's by a second would otherwise
 * refuse every fresh token. Matches the default in Clerk's own verifier.
 */
export const CLOCK_TOLERANCE = "5s";

export type VerifyFailure =
  | "malformed"
  | "invalid_token"
  | "expired"
  | "wrong_issuer"
  /**
   * The issuer's key set could not be fetched, so nothing is known about the
   * token. Callers must answer this with a 5xx and no re-authentication
   * challenge: a fresh token would fail the same way.
   */
  | "unavailable";

export function classifyVerifyError(error: unknown): VerifyFailure {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code: unknown }).code
      : undefined;

  switch (code) {
    case undefined:
    case "ERR_JOSE_GENERIC":
    case "ERR_JWKS_TIMEOUT":
      // A code-less error is the network failure fetch itself threw; the
      // generic code is jose reporting a non-200 or unparsable JWKS response.
      return "unavailable";
    case "ERR_JWT_EXPIRED":
      return "expired";
    case "ERR_JWT_CLAIM_VALIDATION_FAILED":
      return isIssuerClaim(error) ? "wrong_issuer" : "invalid_token";
    case "ERR_JWS_INVALID":
    case "ERR_JWT_INVALID":
      return "malformed";
    default:
      return "invalid_token";
  }
}

function isIssuerClaim(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "claim" in error &&
    (error as { claim: unknown }).claim === "iss"
  );
}
