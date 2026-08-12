/**
 * Response headers the credits middleware sets on billable endpoints, read
 * back by API clients (e.g. the MCP server). Reads are case-insensitive —
 * these are the canonical casings the API sends.
 */
export const CREDITS_REMAINING_HEADER = "X-Credits-Remaining";
export const CREDITS_CHARGED_HEADER = "X-Credits-Charged";
