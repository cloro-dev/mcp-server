import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function toolResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

/**
 * For a tool that declares an `outputSchema`. The SDK checks
 * `structuredContent` against that schema. The text block carries the same
 * JSON for clients that do not read `structuredContent`.
 */
export function structuredToolResult(
  value: Record<string, unknown>,
): CallToolResult {
  return { ...toolResult(value), structuredContent: value };
}
