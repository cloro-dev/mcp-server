import { z } from "zod";

export const googleProductSchema = z.strictObject({
  productResultToken: z.string().trim().min(1).max(512),
});
