import { z } from "zod";
import { withState } from "./state.schema";
import { createCountrySchema } from "./country.schema";
import { ALL_COUNTRY_CODES } from "./all-countries";
import { getAvailableCountries } from "./utils";

const COPILOT_BLOCKED_COUNTRIES: string[] = [
  "BY", // Belarus
  "CN", // China
  "IR",
  "RU", // Russia
  "SY", // Syria
  "VE", // Venezuela
];

export const COPILOT_AVAILABLE_COUNTRIES = getAvailableCountries(
  ALL_COUNTRY_CODES,
  COPILOT_BLOCKED_COUNTRIES,
);

export const copilotSchema = withState({
  prompt: z
    .string("Prompt cannot be empty")
    .min(1, "Prompt cannot be empty")
    .max(10_000, "Prompt is too long (max 10,000 characters)")
    .trim(),
  country: createCountrySchema(ALL_COUNTRY_CODES, COPILOT_BLOCKED_COUNTRIES),
  include: z
    .object({
      markdown: z.boolean(),
      html: z.boolean(),
      rawResponse: z.boolean(),
    })
    .partial()
    .optional(),
});
