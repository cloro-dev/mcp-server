import { z } from "zod";
import { withState } from "./state.schema";

import { createCountrySchema } from "./country.schema";
import { ALL_COUNTRY_CODES } from "./all-countries";
import { getAvailableCountries } from "./utils";

const CHATGPT_BLOCKED_COUNTRIES: string[] = [
  "CN", // China
  "CZ", // Czechia
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

export const chatgptSchema = withState({
  prompt: z
    .string("Prompt cannot be empty")
    .min(1, "Prompt cannot be empty")
    .max(10_000, "Prompt is too long (max 10,000 characters)")
    .trim(),
  country: createCountrySchema(ALL_COUNTRY_CODES, CHATGPT_BLOCKED_COUNTRIES),
  include: z
    .object({
      markdown: z.boolean(),
      rawResponse: z.boolean(),
      searchQueries: z.boolean(),
      html: z.boolean(),
      ads: z.boolean(),
      shopping: z.boolean(),
    })
    .partial()
    .optional(),
});
