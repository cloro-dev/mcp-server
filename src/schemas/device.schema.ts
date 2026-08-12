import { z } from "zod";

/**
 * Device the Google scrape emulates. `desktop` and `mobile` pick the SERP
 * layout; the mobile variants additionally select the impersonated TLS/UA
 * client: `ios` → Safari, `android` (and legacy `mobile`) → Chrome on Android.
 * All three phone values render the mobile SERP.
 */
export const googleDeviceSchema = z
  .enum(["desktop", "mobile", "ios", "android"])
  .default("desktop");
