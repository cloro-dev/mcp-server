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
