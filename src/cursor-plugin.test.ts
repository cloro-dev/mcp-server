import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Guards the Cursor marketplace plugin. The marketplace reviews a submitted
 * repo against a checklist, and a failure there costs a review round trip
 * rather than a test run. Every assertion below is one checklist item.
 */

const read = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

const pluginJson = read(".cursor-plugin/plugin.json") as {
  name: string;
  version: string;
  logo: string;
  variables?: {
    properties?: Record<string, unknown>;
    required?: string[];
  };
};
const mcpJson = read("mcp.json") as {
  mcpServers: Record<string, { url: string; headers?: Record<string, string> }>;
};
const packageJson = read("package.json") as { version: string };

const pluginRoot = new URL("../", import.meta.url);

describe(".cursor-plugin/plugin.json", () => {
  // A fourth file now carries the version. server.json and src/server.ts are
  // covered elsewhere; this keeps the marketplace listing from drifting the
  // way the landing page's server card did.
  it("declares the same version as package.json", () => {
    expect(pluginJson.version).toBe(packageJson.version);
  });

  it("uses a kebab-case name", () => {
    expect(pluginJson.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  // The checklist wants the logo committed and referenced by a relative path.
  // An absolute path or a `..` escape fails review.
  it("points at a committed logo by relative path", () => {
    expect(pluginJson.logo.startsWith("/")).toBe(false);
    expect(pluginJson.logo).not.toContain("..");
    expect(existsSync(new URL(pluginJson.logo, pluginRoot))).toBe(true);
  });
});

describe("mcp.json", () => {
  it("points every server at an https cloro.dev host", () => {
    const servers = Object.values(mcpJson.mcpServers);
    expect(servers.length).toBeGreaterThan(0);
    for (const server of servers) {
      const { protocol, hostname } = new URL(server.url);
      expect(protocol, server.url).toBe("https:");
      expect(
        hostname === "cloro.dev" || hostname.endsWith(".cloro.dev"),
        server.url,
      ).toBe(true);
    }
  });

  // The one failure mode with no local symptom: a `${VAR}` that no manifest
  // variable declares never gets prompted for, so the server 401s for every
  // user who installs the plugin.
  it("declares every ${VAR} placeholder in the manifest variables", () => {
    const placeholders = new Set(
      [...JSON.stringify(mcpJson).matchAll(/\$\{([A-Z0-9_]+)\}/g)].map(
        (match) => match[1],
      ),
    );
    expect(placeholders.size).toBeGreaterThan(0);
    for (const name of placeholders) {
      expect(Object.keys(pluginJson.variables?.properties ?? {})).toContain(
        name,
      );
      expect(pluginJson.variables?.required ?? []).toContain(name);
    }
  });

  // No secret values in the repo. A real key here would ship to the
  // marketplace and to every clone.
  it("carries no literal key in the auth header", () => {
    for (const server of Object.values(mcpJson.mcpServers)) {
      const auth = server.headers?.Authorization;
      expect(auth).toBe("Bearer ${CLORO_API_KEY}");
    }
  });
});
