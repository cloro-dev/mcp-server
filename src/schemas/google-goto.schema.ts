import { z } from "zod";

const GOOGLE_HOSTS = new Set(["www.google.com", "google.com"]);
const REDIRECT_PATHS = new Set(["/goto", "/url"]);

/**
 * Body for POST /v1/monitor/google/goto: resolve one Google redirect
 * link, as shipped in `redirectLink` (ENG-907). Accepts the
 * absolute form the scraper emits — `https://www.google.com/goto?url=...`
 * or `https://www.google.com/url?...`.
 */
export const googleGotoSchema = z.object({
  url: z
    .string()
    .url()
    .superRefine((value, ctx) => {
      const parsed = new URL(value);
      if (
        !GOOGLE_HOSTS.has(parsed.hostname) ||
        !REDIRECT_PATHS.has(parsed.pathname)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "url must be a google.com /goto or /url redirect link",
        });
      }
    }),
});
