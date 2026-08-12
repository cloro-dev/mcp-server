import { z } from "zod";
import { withState } from "./state.schema";
import { createCountrySchema } from "./country.schema";
import { ALL_COUNTRY_CODES } from "./all-countries";
import { getAvailableCountries } from "./utils";

const GEMINI_BLOCKED_COUNTRIES: string[] = [
  "BY", // Belarus
  "CN", // China
  "RU", // Russia
];

export const GEMINI_AVAILABLE_COUNTRIES = getAvailableCountries(
  ALL_COUNTRY_CODES,
  GEMINI_BLOCKED_COUNTRIES,
);

export const geminiSchema = withState({
  prompt: z
    .string("Prompt cannot be empty")
    .min(1, "Prompt cannot be empty")
    .max(10_000, "Prompt is too long (max 10,000 characters)")
    .trim(),
  country: createCountrySchema(ALL_COUNTRY_CODES, GEMINI_BLOCKED_COUNTRIES),
  include: z
    .object({
      html: z.boolean(),
      markdown: z.boolean(),
      rawResponse: z.boolean(),
    })
    .partial()
    .optional(),
});
