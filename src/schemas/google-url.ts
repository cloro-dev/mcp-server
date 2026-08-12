/**
 * Parsing and validation for caller-supplied Google search URLs (ENG-536).
 *
 * `url` mode lets an integrator hand us a complete `google.com/search` URL
 * instead of Cloro's structured `query` + targeting fields. This module
 * **decomposes** that URL into the fields the scrape worker already consumes —
 * `q` becomes the prompt, `gl` the country, `hl` the language override, `uule`
 * the location encoding — so the worker needs no knowledge of `url` mode to
 * serve the request.
 *
 * The supported set is closed: `q`, `gl`, `hl`, `uule`, `start`, `tbs`, `safe`
 * (plus `num`, read as depth). Params outside it are dropped rather than
 * forwarded, so the queue message stays a typed contract the worker can rely
 * on instead of an arbitrary bag whose keys nothing validates.
 *
 * Depth is the one value that does not pass straight through. Google caps `num`
 * at 10 on web search, so `num` is read as *requested depth* and converted to a
 * page count the worker fulfils by paginating `start`; `pages` and `startOffset`
 * are what pagination keys on.
 *
 * Failures come back as a typed reason rather than a throw, so the schema layer
 * owns the mapping onto Zod issues and their messages.
 */

/** Google serves 10 organic results per page; depth is bought in page units. */
const RESULTS_PER_PAGE = 10;

/** Mirrors the `pages` ceiling on the structured request contract. */
const MAX_PAGES = 10;

/**
 * `google.com`, `google.co.uk`, `www.google.de`, ... but not `news.google.com`
 * or `images.google.com` — those are verticals with their own parsers, and one
 * of them (News) has its own billed model.
 */
const GOOGLE_SEARCH_HOST = /^(?:www\.)?google(?:\.[a-z]{2,3})+$/;

const SEARCH_PATH = "/search";

export type GoogleUrlRejectionReason =
  | "malformed"
  | "host"
  | "path"
  | "vertical"
  | "missing-query";

export type GoogleUrlParsed = {
  /** `q` — becomes the worker's `prompt`. */
  query: string;
  /** `gl`, uppercased to match the supported-country list. Null when absent. */
  country: string | null;
  /** `hl`, lowercased. The interface-language override this feature exists for. */
  language: string | null;
  /** `uule` — the encoded location, passed through untouched. */
  uule: string | null;
  /** `start`, the offset the first fetch begins from. */
  startOffset: number;
  /** Page count derived from `num`, capped at the structured-mode ceiling. */
  pages: number;
  /** `tbs` — Google's search-refinement filter, passed through untouched. */
  tbs: string | null;
  /** `safe` — SafeSearch setting, passed through untouched. */
  safe: string | null;
};

export type GoogleUrlParseResult =
  | ({ ok: true } & GoogleUrlParsed)
  | { ok: false; reason: GoogleUrlRejectionReason };

/**
 * Read a non-negative integer search param, falling back when it is absent,
 * non-numeric, or negative. Callers compose their own URLs, so a junk `num`
 * should degrade to the default rather than reject the whole request.
 */
const readNonNegativeInt = (
  params: URLSearchParams,
  key: string,
  fallback: number,
): number => {
  const raw = params.get(key);
  if (raw === null) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;

  return parsed;
};

/** Convert requested result count into the page count the worker will fetch. */
const pagesForResultCount = (num: number): number => {
  if (num < 1) return 1;
  return Math.min(Math.ceil(num / RESULTS_PER_PAGE), MAX_PAGES);
};

const readTrimmed = (params: URLSearchParams, key: string): string | null =>
  params.get(key)?.trim() || null;

export const parseGoogleSearchUrl = (raw: string): GoogleUrlParseResult => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "malformed" };
  }

  if (!GOOGLE_SEARCH_HOST.test(url.hostname)) {
    return { ok: false, reason: "host" };
  }

  if (url.pathname !== SEARCH_PATH) {
    return { ok: false, reason: "path" };
  }

  // `tbm` routes to a Google vertical, not web search. News has its own model
  // and parser; the rest have no parser at all.
  if (url.searchParams.has("tbm")) {
    return { ok: false, reason: "vertical" };
  }

  const query = readTrimmed(url.searchParams, "q");
  if (!query) {
    return { ok: false, reason: "missing-query" };
  }

  return {
    ok: true,
    query,
    country: readTrimmed(url.searchParams, "gl")?.toUpperCase() ?? null,
    language: readTrimmed(url.searchParams, "hl")?.toLowerCase() ?? null,
    uule: readTrimmed(url.searchParams, "uule"),
    startOffset: readNonNegativeInt(url.searchParams, "start", 0),
    pages: pagesForResultCount(
      readNonNegativeInt(url.searchParams, "num", RESULTS_PER_PAGE),
    ),
    tbs: readTrimmed(url.searchParams, "tbs"),
    safe: readTrimmed(url.searchParams, "safe"),
  };
};
