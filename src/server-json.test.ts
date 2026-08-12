import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Guards the registry entry. `mcp-publisher validate` checks it against the
 * live registry, but that needs network and only runs at publish time — by
 * which point a bad edit has already been merged. These assertions cover the
 * constraints that actually bite, locally and offline.
 */

const read = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

const serverJson = read("server.json") as {
  name: string;
  description: string;
  version: string;
  websiteUrl: string;
  icons?: Array<{ src: string; mimeType?: string }>;
  remotes: Array<{ type: string; url: string }>;
};
const packageJson = read("package.json") as { version: string };

describe("server.json", () => {
  // Three files carry this version and nothing else keeps them in step. The
  // landing page's server-card drifted to 1.0.0 exactly this way; the registry
  // treats each version as a distinct release, so a mismatch is not free to
  // undo. src/server.ts is covered in server.test.ts, which has a live client.
  it("declares the same version as package.json", () => {
    expect(serverJson.version).toBe(packageJson.version);
  });

  // maxLength 100 in the registry schema. Easy to blow past when editing copy,
  // and the failure surfaces only at publish.
  it("keeps the description within the registry's 100-char limit", () => {
    expect(serverJson.description.length).toBeLessThanOrEqual(100);
  });

  // Namespace is DNS-verified against cloro.dev, and the registry requires
  // remote URLs to resolve to the verified domain or a subdomain.
  it("points every remote at an https cloro.dev host", () => {
    expect(serverJson.name).toBe("dev.cloro/cloro");
    expect(serverJson.remotes.length).toBeGreaterThan(0);
    for (const remote of serverJson.remotes) {
      const { protocol, hostname } = new URL(remote.url);
      expect(protocol, remote.url).toBe("https:");
      expect(
        hostname === "cloro.dev" || hostname.endsWith(".cloro.dev"),
        remote.url,
      ).toBe(true);
    }
  });

  // Directories that ingest the registry render this icon; a broken or
  // non-https src shows as a blank tile in the listing.
  it("serves icons over https with a supported mime type", () => {
    const supported = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/svg+xml",
      "image/webp",
    ];
    expect(serverJson.icons?.length).toBeGreaterThan(0);
    for (const icon of serverJson.icons ?? []) {
      expect(new URL(icon.src).protocol, icon.src).toBe("https:");
      expect(supported, icon.src).toContain(icon.mimeType);
    }
  });
});
