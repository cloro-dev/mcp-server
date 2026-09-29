/**
 * Tells a cloro API key apart from an OAuth access token.
 *
 * Both arrive in the same `Authorization: Bearer ...` position, so every
 * entry point that accepts either has to decide which one it is holding
 * before it can validate it. The two formats do not overlap: a key is
 * `sk_live_` / `sk_test_` plus 32 hex characters, and a JWT is three
 * base64url segments separated by dots. Nothing is a valid instance of both.
 *
 * The check is deliberately shape-only. It says which validator to run, not
 * whether the credential is good — `looksLikeOAuthToken` returning true means
 * "verify this as a JWT", and that verification is still free to reject it.
 */

/** `sk_live_` / `sk_test_` plus the 32 hex chars `generateApiKey` produces. */
const API_KEY_PATTERN = /^sk_(live|test)_[a-f0-9]{32}$/;

/** Three non-empty base64url segments. */
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function looksLikeApiKey(credential: string): boolean {
  return API_KEY_PATTERN.test(credential);
}

export function looksLikeOAuthToken(credential: string): boolean {
  return !looksLikeApiKey(credential) && JWT_PATTERN.test(credential);
}
