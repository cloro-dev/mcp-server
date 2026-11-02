import { z } from "zod";
import { withState } from "./state.schema";

import { createCountrySchema } from "./country.schema";
import { ALL_COUNTRY_CODES } from "./all-countries";
import { getAvailableCountries } from "./utils";

const CHATGPT_BLOCKED_COUNTRIES: string[] = [
  "CN", // China
  "HK", // Hong Kong
  "IR", // Iran
  "MO", // Macao
  "RU", // Russia
  "VE", // Venezuela
];

export const CHATGPT_AVAILABLE_COUNTRIES = getAvailableCountries(
  ALL_COUNTRY_CODES,
  CHATGPT_BLOCKED_COUNTRIES,
);

export const CHATGPT_MAX_PROMPTS = 5;

const promptSchema = z
  .string("Prompt cannot be empty")
  .min(1, "Prompt cannot be empty")
  .max(10_000, "Prompt is too long (max 10,000 characters)")
  .trim();

export const chatgptSchema = withState({
  // An array asks each prompt as a follow-up in the same conversation.
  prompt: z.union([
    promptSchema,
    z
      .array(promptSchema)
      .min(1, "Prompt cannot be empty")
      .max(
        CHATGPT_MAX_PROMPTS,
        `Too many prompts (max ${CHATGPT_MAX_PROMPTS})`,
      ),
  ]),
  country: createCountrySchema(ALL_COUNTRY_CODES, CHATGPT_BLOCKED_COUNTRIES),
  include: z
    .object({
      markdown: z.boolean(),
      rawResponse: z.boolean(),
      searchQueries: z.boolean(),
      html: z.boolean(),
      ads: z.boolean(),
      shopping: z.boolean(),
      // Requires shopping to be enabled.
      productDetails: z.boolean(),
    })
    .partial()
    .optional(),
  // Serve ChatGPT's legacy (desktop) UI instead of the default mobile-web UI,
  // which is used when unset.
  legacy: z.boolean().optional(),
  disableWebSearch: z.boolean().optional(),
});
