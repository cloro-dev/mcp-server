import { z } from "zod";
import { geoFields, refineGeo, applyGeo } from "./geo.schema";
import { ALL_COUNTRY_CODES } from "./all-countries";

export const AIMODE_AVAILABLE_COUNTRIES = ALL_COUNTRY_CODES;

export const aimodeSchema = z
  .object({
    prompt: z
      .string("Prompt cannot be empty")
      .min(1, "Prompt cannot be empty")
      .max(10_000, "Prompt is too long (max 10,000 characters)")
      .trim(),
    // `hl` is the interface-language override (ENG-828): a country alone
    // cannot express "German interface from a US exit", and multilingual
    // countries (CH, BE, CA) resolve to one dominant language. `gl` is the
    // result geography. `country` is the deprecated alias normalized into
    // `gl`.
    ...geoFields(AIMODE_AVAILABLE_COUNTRIES),
    location: z.string().trim().optional(),
    uule: z.string().trim().optional(),
    device: z.enum(["desktop", "mobile"]).default("desktop"),
    include: z
      .object({
        markdown: z.boolean(),
        html: z.boolean(),
        expandProducts: z.boolean(),
      })
      .partial()
      .optional(),
  })
  .superRefine((data, ctx) => refineGeo(data, ctx))
  .refine((data) => !(data.location && data.uule), {
    message: "Cannot set both location and uule; provide only one",
    path: ["uule"],
  })
  .transform(applyGeo);
