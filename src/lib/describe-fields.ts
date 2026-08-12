import { z } from "zod";

/**
 * Clone a Zod raw shape with `.describe()` applied to selected fields, so the
 * shared request schemas from ./schemas stay untouched while the
 * MCP tool schemas carry LLM-friendly parameter docs.
 */
export function describeFields<T extends z.ZodRawShape>(
  shape: T,
  docs: Partial<Record<keyof T, string>>,
): T {
  const out: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(shape)) {
    const doc = docs[key as keyof T];
    out[key] = doc ? (field as z.ZodType).describe(doc) : (field as z.ZodType);
  }
  return out as unknown as T;
}
