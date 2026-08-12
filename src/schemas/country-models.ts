import { AIMODE_AVAILABLE_COUNTRIES } from "./aimode.schema";
import { AIOVERVIEW_AVAILABLE_COUNTRIES } from "./aioverview.schema";
import { CHATGPT_AVAILABLE_COUNTRIES } from "./chatgpt.schema";
import { COPILOT_AVAILABLE_COUNTRIES } from "./copilot.schema";
import { GEMINI_AVAILABLE_COUNTRIES } from "./gemini.schema";
import { GOOGLE_AVAILABLE_COUNTRIES } from "./google.schema";
import { GROK_AVAILABLE_COUNTRIES } from "./grok.schema";
import { PERPLEXITY_AVAILABLE_COUNTRIES } from "./perplexity.schema";

/**
 * The model keys accepted by GET /v1/countries?model=, in one place so the
 * API handler and the MCP server's tool enum can't drift apart. Adding an
 * engine here (key + countries entry) updates both.
 */
export const COUNTRY_MODELS = [
  "aimode",
  "aioverview",
  "chatgpt",
  "copilot",
  "gemini",
  "google",
  "grok",
  "perplexity",
] as const;

export type CountryModel = (typeof COUNTRY_MODELS)[number];

export const MODEL_COUNTRIES: Record<CountryModel, string[]> = {
  aimode: AIMODE_AVAILABLE_COUNTRIES,
  aioverview: AIOVERVIEW_AVAILABLE_COUNTRIES,
  chatgpt: CHATGPT_AVAILABLE_COUNTRIES,
  copilot: COPILOT_AVAILABLE_COUNTRIES,
  gemini: GEMINI_AVAILABLE_COUNTRIES,
  google: GOOGLE_AVAILABLE_COUNTRIES,
  grok: GROK_AVAILABLE_COUNTRIES,
  perplexity: PERPLEXITY_AVAILABLE_COUNTRIES,
};
