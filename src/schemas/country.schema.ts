import { z } from "zod";

export const createCountrySchema = (
  availableCountries: string[],
  blockedCountries: string[],
) => {
  return z.string().superRefine((val, ctx) => {
    if (blockedCountries.includes(val)) {
      ctx.addIssue({
        code: "custom",
        message:
          "This model is not available in this country. Please select a different country.",
      });
      return;
    }

    if (!availableCountries.includes(val)) {
      ctx.addIssue({
        code: "custom",
        message:
          "We currently do not support this country code. If you'd like us to add support, please reach out to our support team and we will implement it.",
      });
      return;
    }
  });
};
