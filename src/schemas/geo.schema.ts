import { z } from "zod";
import { createCountrySchema } from "./country.schema";

/**
 * Google's own geo vocabulary — `hl` (interface language) and `gl` (result
 * geography) — as first-class request fields.
 *
 * `country` used to do three jobs at once: seed `gl`, seed `hl` through the
 * worker's country-to-language table, and act as a soft preference when
 * leasing a farmed session. Callers could not separate them, so a German
 * interface was only reachable by asking for DE and multilingual countries
 * collapsed to one dominant language. Integrators also arrive already
 * speaking `hl`/`gl`, because Google's docs and every competing SERP API use
 * those names.
 *
 * `country` stays accepted and behaves exactly as before; it is normalized
 * into `gl` here and is deprecated in favour of it.
 *
 * Two constraints shape this module:
 *
 * 1. **Normalization must be idempotent.** `validateBodyMiddleware` replaces
 *    `req.body` with the parsed output, and the async scheduler re-validates
 *    persisted payloads against this same schema (ENG-662). Parsing an
 *    already-normalized payload must produce an identical result and must not
 *    raise a conflict — hence the case-insensitive comparison below.
 * 2. **`gl` is emitted lowercase, validated uppercase.** Google's wire format
 *    is lowercase; the supported-country constants are uppercase.
 */

/** `hl` — free-form. Google owns the language-code list, so a closed enum here
 * would reject codes it accepts (`pt-br`, `zh-tw`, ...). */
export const hlField = z.string().trim().toLowerCase().optional();

/**
 * `gl` — validated against the endpoint's own supported-country list, since
 * Cloro owns which exits it stocks and which countries each model supports.
 * Compared uppercase; the list constants are uppercase ISO codes.
 */
export const createGlSchema = (availableCountries: string[]) =>
  z
    .string()
    .trim()
    .superRefine((val, ctx) => {
      if (!availableCountries.includes(val.toUpperCase())) {
        ctx.addIssue({
          code: "custom",
          message:
            "We currently do not support this country code. If you'd like us to add support, please reach out to our support team and we will implement it.",
        });
      }
    })
    .optional();

/**
 * The geo field trio for an endpoint's object shape. `country` keeps its
 * existing validation and message; it is optional here because `gl` can stand
 * in for it. Presence is enforced by `refineGeo`.
 */
export const geoFields = (availableCountries: string[]) => ({
  country: createCountrySchema(availableCountries, []).optional(),
  gl: createGlSchema(availableCountries),
  hl: hlField,
});

export type GeoInput = {
  country?: string;
  gl?: string;
  hl?: string;
};

export type GeoOutput = {
  country: string;
  gl: string;
  hl?: string;
};

/**
 * Cross-field geo rules. `country` and `gl` are two channels for one fact, so
 * a disagreement is rejected rather than resolved by a silent precedence rule
 * — the same reasoning the `location` / `uule` refinement already applies.
 * An agreeing pair is the alias round-tripping and is accepted, which is what
 * keeps normalization idempotent.
 *
 * `requirePresence: false` is for callers that resolve geo from another
 * channel (Google's `url` mode reads it from the URL's `gl`) and emit their
 * own message when nothing resolves.
 */
export function refineGeo(
  data: GeoInput,
  ctx: z.RefinementCtx,
  { requirePresence = true }: { requirePresence?: boolean } = {},
): void {
  if (data.country && data.gl) {
    if (data.country.toUpperCase() !== data.gl.toUpperCase()) {
      ctx.addIssue({
        code: "custom",
        path: ["gl"],
        message: `Cannot set both country and gl to different values (country: "${data.country}", gl: "${data.gl}"); country is deprecated — send gl alone`,
      });
    }
    return;
  }

  if (requirePresence && !data.country && !data.gl) {
    ctx.addIssue({
      code: "custom",
      path: ["gl"],
      message: "Provide gl (or country, which is deprecated)",
    });
  }
}

/**
 * Collapse whichever geo channels were supplied into the canonical trio.
 *
 * `country` is still emitted because the browsers worker reads it off the
 * queue message today; dropping it would silently serve every request from
 * the wrong geography. It is derived here rather than caller-authored, and
 * comes out once browsers consumes `gl`.
 *
 * Returns `null` when no geo resolved, so callers that allow that (Google's
 * `url` mode before URL derivation) can decide what to do.
 */
export function normalizeGeo(data: GeoInput): GeoOutput | null {
  const source = data.gl ?? data.country;
  if (!source) return null;

  return {
    gl: source.toLowerCase(),
    country: source.toUpperCase(),
    hl: data.hl,
  };
}

/**
 * Transform helper: collapse the geo channels and merge them back over the
 * parsed body. Endpoints whose transform does nothing else can pass this
 * directly to `.transform()`.
 *
 * Non-null assertion is safe wherever `refineGeo` ran with
 * `requirePresence: true` — a body carrying neither channel never reaches here.
 */
export function applyGeo<T extends GeoInput>(data: T): T & GeoOutput {
  const geo = normalizeGeo(data)!;
  return { ...data, country: geo.country, gl: geo.gl, hl: geo.hl };
}
