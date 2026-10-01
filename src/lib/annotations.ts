import { oauth } from "../config";

/**
 * Shared tool annotation base. Every cloro tool is read-only, so the two
 * variants in `tools/` extend this rather than restating it.
 *
 * These are not cosmetic: the Anthropic Connectors Directory rejects tools
 * missing a title and the applicable `readOnlyHint`/`destructiveHint`, and the
 * OpenAI plugin review also reads `openWorldHint`. Keeping the shared fields in
 * one place means a newly required annotation can't be added to one tool module
 * and forgotten in the other — which would fail a directory submission long
 * after the omission.
 *
 * `destructiveHint` is redundant next to `readOnlyHint: true` under the MCP
 * spec, but both directory checklists enumerate it by name, so it is stated
 * explicitly.
 */
export const BASE_READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
} as const;

/**
 * `securitySchemes` for ChatGPT's account-linking UI. It goes in `_meta`
 * because the MCP SDK drops unknown top-level tool fields. No `noauth`: an
 * anonymous call gets a 401. The scopes are those of the 401 challenge.
 */
export function toolMeta(): Record<string, unknown> {
  return {
    securitySchemes: [{ type: "oauth2", scopes: oauth.scopes }],
  };
}
