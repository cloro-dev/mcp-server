import { z } from "zod";
import { geoFields, refineGeo, normalizeGeo, applyGeo } from "./geo.schema";
import { googleDeviceSchema } from "./device.schema";
import { ALL_COUNTRY_CODES } from "./all-countries";
import { parseGoogleSearchUrl } from "./google-url";

import type { GoogleUrlRejectionReason } from "./google-url";

export const GOOGLE_AVAILABLE_COUNTRIES = ALL_COUNTRY_CODES;

const DEFAULT_PAGES = 1;

/**
 * Fields the URL owns in `url` mode (ENG-536). Supplying any of them alongside
 * `url` means two channels are expressing the same target with no precedence
 * rule, so the request is rejected rather than silently preferring one.
 */
const URL_OWNED_FIELDS = ["query", "location", "uule", "pages"] as const;

const URL_REJECTION_MESSAGES: Record<GoogleUrlRejectionReason, string> = {
  malformed: "url must be a valid absolute http(s) URL",
  host: "url must be a Google web search host, e.g. www.google.com or google.co.uk",
  path: "url path must be /search",
  vertical:
    "url must not set tbm; use the vertical-specific endpoint instead (POST /v1/monitor/google/news for tbm=nws)",
  "missing-query": "url must include a non-empty q parameter",
};

export const googleSchema = z
  .object({
    // Optional because `url` mode carries the query inside the URL. Exactly one
    // of `query` / `url` is enforced below.
    query: z
      .string("Query cannot be empty")
      .min(1, "Query cannot be empty")
      .max(10_000, "Query is too long (max 10,000 characters)")
      .trim()
      .optional(),
    // A complete google.com/search URL. Cloro forwards it as the fetch target
    // instead of assembling one from the structured fields.
    url: z.string().trim().optional(),
    // `hl` / `gl` are the caller-facing geo contract; `country` is the
    // deprecated alias normalized into `gl`. All three are optional at the
    // field level because `url` mode can derive geo from the URL's `gl` —
    // presence is enforced per-mode below.
    ...geoFields(GOOGLE_AVAILABLE_COUNTRIES),
    location: z.string().trim().optional(),
    uule: z.string().trim().optional(),
    device: googleDeviceSchema,
    // Optional rather than `.default(1)` so the conflict check below can tell
    // "caller sent pages" from "caller sent nothing". The default is applied in
    // the transform, so parsed output is unchanged for structured requests.
    pages: z.number().positive().max(10).optional(),
    include: z
      .object({
        html: z.boolean(),
        aioverview: z.union([
          z.boolean(),
          z
            .object({
              markdown: z.boolean(),
            })
            .partial(),
        ]),
        /**
         * Hydrate AI-Overview-type "People also ask" items via per-PPA
         * `/async/callback:<ons>` fetches. When enabled, AIOVERVIEW
         * items in `peopleAlsoAsk` carry `markdown` + `sources`. When
         * disabled (default), the classifier still runs — AIOVERVIEW
         * items come back with `type` only; LINK items keep their
         * snippet/title/link from the initial HTML.
         *
         * Costs one extra curl_cffi request per AIO-type PPA on the
         * page (typically 1-2), issued sequentially to protect the
         * session pool from 429 bursts.
         */
        paaAioverview: z.boolean(),
      })
      .partial()
      .optional(),
  })
  .refine((data) => !(data.location && data.uule), {
    message: "Cannot set both location and uule; provide only one",
    path: ["uule"],
  })
  .superRefine((data, ctx) => {
    // Conflict between the two geo channels is always an error, in either
    // mode. Presence is mode-specific, so it is enforced below instead.
    refineGeo(data, ctx, { requirePresence: false });

    if (!data.query && !data.url) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either query or url",
        path: ["query"],
      });
      return;
    }

    if (!data.url) {
      // Structured mode has no URL to derive geo from.
      if (!data.country && !data.gl) {
        ctx.addIssue({
          code: "custom",
          message: "Provide gl (or country, which is deprecated)",
          path: ["gl"],
        });
      }
      return;
    }

    const parsed = parseGoogleSearchUrl(data.url);

    // The transform below emits `query`/`uule`/`pages` alongside `url`, and the
    // async scheduler re-validates persisted payloads with this same schema
    // (ENG-662). A field that exactly equals what the URL derives is therefore
    // the URL's own value round-tripping, not two channels in conflict — only
    // a *differing* value is ambiguous. `location` is never emitted by the
    // transform, so it stays a strict conflict.
    const urlDerived: Record<
      (typeof URL_OWNED_FIELDS)[number],
      unknown
    > | null = parsed.ok
      ? {
          query: parsed.query,
          location: undefined,
          uule: parsed.uule ?? undefined,
          pages: parsed.pages,
        }
      : null;

    for (const field of URL_OWNED_FIELDS) {
      if (data[field] === undefined) continue;
      if (urlDerived && data[field] === urlDerived[field]) continue;
      ctx.addIssue({
        code: "custom",
        message: `Cannot set both url and ${field}; the URL owns this value`,
        path: [field],
      });
    }

    if (!parsed.ok) {
      ctx.addIssue({
        code: "custom",
        message: URL_REJECTION_MESSAGES[parsed.reason],
        path: ["url"],
      });
      return;
    }

    // `hl` / `gl` (or the deprecated `country`) next to a URL that carries its
    // own copy is two channels for one fact, like the URL-owned fields above.
    // An agreeing pair is the transform output round-tripping and is accepted.
    if (data.hl && parsed.language && data.hl !== parsed.language) {
      ctx.addIssue({
        code: "custom",
        message: "Cannot set both url and hl; the URL owns this value",
        path: ["hl"],
      });
    }

    const explicitGl = (data.gl ?? data.country)?.toUpperCase();
    if (explicitGl) {
      if (parsed.country && parsed.country !== explicitGl) {
        const field = data.gl ? "gl" : "country";
        ctx.addIssue({
          code: "custom",
          message: `Cannot set both url and ${field}; the URL owns this value`,
          path: [field],
        });
      }
      return;
    }

    if (!parsed.country) {
      ctx.addIssue({
        code: "custom",
        message: "Provide gl, or include gl= in the url so it can be derived",
        path: ["gl"],
      });
      return;
    }

    if (!GOOGLE_AVAILABLE_COUNTRIES.includes(parsed.country)) {
      ctx.addIssue({
        code: "custom",
        message: `Derived country "${parsed.country}" from the url's gl is not supported; pass a supported gl explicitly`,
        path: ["gl"],
      });
    }
  })
  .transform((data) => {
    const parsed = data.url ? parseGoogleSearchUrl(data.url) : null;

    // Structured mode, and the unreachable case where a URL that superRefine
    // already rejected somehow arrives here. Both branches return the same key
    // set so the inferred output type stays a single object, not a union.
    if (!parsed?.ok) {
      return {
        // Geo presence is guaranteed in structured mode by the refinement above.
        ...applyGeo(data),
        pages: data.pages ?? DEFAULT_PAGES,
        startOffset: undefined as number | undefined,
        tbs: undefined as string | undefined,
        safe: undefined as string | undefined,
      };
    }

    // Decompose the URL into the fields the worker already consumes, so `url`
    // mode needs no special handling downstream: `q` becomes the prompt, `gl`
    // and `hl` the geo pair, `uule` the location, and `tbs` / `safe` ride along
    // as their own keys. Explicit `hl` / `gl` either agree with the URL's
    // copies (enforced above) or fill in when the URL has none.
    //
    // `pages` / `startOffset` are the pagination authority — `num` is capped at
    // 10 by Google, so depth is fulfilled by paginating `start` instead.
    const geo = normalizeGeo({
      gl: data.gl ?? data.country ?? (parsed.country as string),
      hl: data.hl ?? parsed.language ?? undefined,
    })!;

    return {
      ...data,
      query: parsed.query,
      country: geo.country,
      gl: geo.gl,
      hl: geo.hl,
      uule: parsed.uule ?? undefined,
      pages: parsed.pages,
      startOffset: parsed.startOffset as number | undefined,
      tbs: parsed.tbs ?? undefined,
      safe: parsed.safe ?? undefined,
    };
  });
