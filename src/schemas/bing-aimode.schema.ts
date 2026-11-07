import { z } from "zod";
import { withState } from "./state.schema";
import { createCountrySchema } from "./country.schema";
import { ALL_COUNTRY_CODES } from "./all-countries";
import {
  COPILOT_AVAILABLE_COUNTRIES,
  COPILOT_BLOCKED_COUNTRIES,
} from "./copilot.schema";

// Bing AI Mode is not available in BY, CN, IR, RU, SY and VE.
export const BING_AIMODE_AVAILABLE_COUNTRIES = COPILOT_AVAILABLE_COUNTRIES;

// Bing takes the prompt in the page's query string and rejects it past about
// 4 KB once URL-encoded, so a CJK prompt (9 bytes a character) runs out first.
const MAX_ENCODED_PROMPT_LENGTH = 3_500;

const encodedLength = (prompt: string) =>
  encodeURIComponent(prompt).replace(/%20/g, "+").length;

export const bingAimodeSchema = withState({
  prompt: z
    .string("Prompt cannot be empty")
    .min(1, "Prompt cannot be empty")
    .trim()
    .refine(
      (prompt) => encodedLength(prompt) <= MAX_ENCODED_PROMPT_LENGTH,
      "Prompt is too long (max 3,500 characters, fewer for non-Latin scripts)",
    ),
  country: createCountrySchema(ALL_COUNTRY_CODES, COPILOT_BLOCKED_COUNTRIES),
  include: z
    .object({
      markdown: z.boolean(),
      html: z.boolean(),
    })
    .partial()
    .optional(),
});
