import { z } from "zod";
import { createCountrySchema } from "./country.schema";
import { googleDeviceSchema } from "./device.schema";
import { ALL_COUNTRY_CODES } from "./all-countries";

export const GOOGLE_NEWS_AVAILABLE_COUNTRIES = ALL_COUNTRY_CODES;

export const googleNewsSchema = z.object({
  query: z
    .string("Query cannot be empty")
    .min(1, "Query cannot be empty")
    .max(10_000, "Query is too long (max 10,000 characters)")
    .trim(),
  country: createCountrySchema(GOOGLE_NEWS_AVAILABLE_COUNTRIES, []),
  device: googleDeviceSchema,
  pages: z.number().positive().max(10).default(1),
  include: z
    .object({
      html: z.boolean(),
    })
    .partial()
    .optional(),
});
