import { z } from "zod";

/**
 * US states (incl. DC) available for state-level proxy targeting. Customers
 * send the 2-letter USPS `code`; `name` is for display (e.g. the /states API).
 * State targeting is US-only today.
 */
export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

/**
 * Countries with state-level proxy targeting, keyed by ISO 3166-1 alpha-2.
 * This is the single edit that adds a country: it drives GET /v1/states,
 * the MCP `list_states` tool's country enum, and the `state` validation on
 * every scrape schema, so the three cannot drift.
 */
export const STATES_BY_COUNTRY: Readonly<
  Record<string, ReadonlyArray<{ code: string; name: string }>>
> = {
  US: US_STATES,
};

export const STATE_COUNTRIES = Object.keys(STATES_BY_COUNTRY) as [
  string,
  ...string[],
];

/** Available states for a country code. Unsupported countries return []. */
export function availableStates(
  country: string,
): ReadonlyArray<{ code: string; name: string }> {
  return STATES_BY_COUNTRY[country.toUpperCase()] ?? [];
}

/** Whether `code` is a valid state code for `country`. */
export function isValidState(country: string, code: string): boolean {
  const wanted = code.toUpperCase();
  return availableStates(country).some((s) => s.code === wanted);
}

/**
 * Optional state field. The cross-field rules (supported country, valid code
 * for that country) depend on `country`, so they live in `refineState`
 * applied at the object level.
 */
export const stateField = z.string().optional();

export function refineState(
  data: { country?: string; state?: string },
  ctx: z.RefinementCtx,
): void {
  if (data.state == null) return;

  const country = data.country?.toUpperCase() ?? "";
  if (availableStates(country).length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["state"],
      message: `\`state\` is not supported for country ${country || "(none)"}.`,
    });
    return;
  }

  if (!isValidState(country, data.state)) {
    ctx.addIssue({
      code: "custom",
      path: ["state"],
      // Points at the discovery endpoint rather than hardcoding an example,
      // so the message stays correct as countries are added.
      message: `Invalid \`state\` for ${country}. Use a code from \`GET /v1/states?country=${country}\`.`,
    });
  }
}

/** Add the optional `state` field + state validation to an object schema. */
export function withState<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...shape, state: stateField })
    .superRefine((data, ctx) =>
      refineState(data as { country?: string; state?: string }, ctx),
    );
}
