import { z } from "zod";
import { withState } from "./state.schema";
import { createCountrySchema } from "./country.schema";
import { ALL_COUNTRY_CODES } from "./all-countries";
import { getAvailableCountries } from "./utils";

const PERPLEXITY_BLOCKED_COUNTRIES: string[] = [
  "CN", // China
];

export const PERPLEXITY_AVAILABLE_COUNTRIES = getAvailableCountries(
  ALL_COUNTRY_CODES,
  PERPLEXITY_BLOCKED_COUNTRIES,
);

export const perplexitySchema = withState({
  prompt: z
    .string("Prompt cannot be empty")
    .min(1, "Prompt cannot be empty")
    .max(10_000, "Prompt is too long (max 10,000 characters)")
    .trim(),
  country: createCountrySchema(ALL_COUNTRY_CODES, PERPLEXITY_BLOCKED_COUNTRIES),
  include: z
    .object({
      markdown: z.boolean(),
      html: z.boolean(),
      rawResponse: z.boolean(),
    })
    .partial()
    .optional(),
});
