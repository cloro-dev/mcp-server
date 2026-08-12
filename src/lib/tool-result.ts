import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function toolResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}
