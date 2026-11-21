import { z } from "zod";
import { withState } from "./state.schema";
import { createCountrySchema } from "./country.schema";
import { ALL_COUNTRY_CODES } from "./all-countries";
import { getAvailableCountries } from "./utils";

// Where Bing answers its AI Mode page with "page not found" or fails every
// request, found by asking from exits inside each country our proxies reach.
export const BING_AIMODE_BLOCKED_COUNTRIES = [
  "CN", // China
  "KR", // South Korea
  "RU", // Russia
];

export const BING_AIMODE_AVAILABLE_COUNTRIES = getAvailableCountries(
  ALL_COUNTRY_CODES,
  BING_AIMODE_BLOCKED_COUNTRIES,
);

// Bing takes the prompt in the page's query string and rejects it past about
// 4 KB once URL-encoded, so a CJK prompt (9 bytes a character) runs out first.
const MAX_ENCODED_LENGTH = 3_500;

const encodedLength = (text: string) =>
  encodeURIComponent(text).replace(/%20/g, "+").length;

/** Text Bing takes in a query string; `name` labels the field in errors. */
export const bingQueryText = (name: string) =>
  z
    .string(`${name} cannot be empty`)
    .min(1, `${name} cannot be empty`)
    .trim()
    .refine(
      (text) => encodedLength(text) <= MAX_ENCODED_LENGTH,
      `${name} is too long (max 3,500 characters, fewer for non-Latin scripts)`,
    );

export const bingAimodeSchema = withState({
  prompt: bingQueryText("Prompt"),
  country: createCountrySchema(
    ALL_COUNTRY_CODES,
    BING_AIMODE_BLOCKED_COUNTRIES,
  ),
  include: z
    .object({
      markdown: z.boolean(),
      html: z.boolean(),
    })
    .partial()
    .optional(),
});
