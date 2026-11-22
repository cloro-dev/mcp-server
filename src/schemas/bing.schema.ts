import { z } from "zod";
import { createCountrySchema } from "./country.schema";
import { ALL_COUNTRY_CODES } from "./all-countries";
import {
  BING_AIMODE_AVAILABLE_COUNTRIES,
  BING_AIMODE_BLOCKED_COUNTRIES,
  bingQueryText,
} from "./bing-aimode.schema";

// Bing search runs on Bing AI Mode's sessions, so it serves the same
// countries. The exit's country picks Bing's market.
export const BING_AVAILABLE_COUNTRIES = BING_AIMODE_AVAILABLE_COUNTRIES;

export const bingSchema = z.object({
  query: bingQueryText("Query"),
  country: createCountrySchema(
    ALL_COUNTRY_CODES,
    BING_AIMODE_BLOCKED_COUNTRIES,
  ),
  pages: z.number().int().positive().max(10).default(1),
  first: z.number().int().positive().optional(),
  include: z
    .object({
      html: z.boolean(),
      // Bing's AI summary, returned as `aioverview` in Google's shape.
      aioverview: z.union([
        z.boolean(),
        z.object({ markdown: z.boolean() }).partial(),
      ]),
    })
    .partial()
    .optional(),
});
