import { describe, expect, it } from "vitest";

import { looksLikeApiKey, looksLikeOAuthToken } from "./credential";

const API_KEY = `sk_live_${"a1b2c3d4".repeat(4)}`;
const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.c2lnbmF0dXJl";

describe("looksLikeApiKey", () => {
  it("accepts live and test keys", () => {
    expect(looksLikeApiKey(API_KEY)).toBe(true);
    expect(looksLikeApiKey(API_KEY.replace("live", "test"))).toBe(true);
  });

  it("rejects the wrong length, uppercase hex, and a bare prefix", () => {
    expect(looksLikeApiKey("sk_live_deadbeef")).toBe(false);
    expect(looksLikeApiKey(`sk_live_${"A1B2C3D4".repeat(4)}`)).toBe(false);
    expect(looksLikeApiKey("sk_live_")).toBe(false);
  });
});

describe("looksLikeOAuthToken", () => {
  it("accepts a three-segment JWT", () => {
    expect(looksLikeOAuthToken(JWT)).toBe(true);
  });

  it("rejects an API key", () => {
    expect(looksLikeOAuthToken(API_KEY)).toBe(false);
  });

  it("rejects anything that is not three segments", () => {
    expect(looksLikeOAuthToken("not.a")).toBe(false);
    expect(looksLikeOAuthToken("a.b.c.d")).toBe(false);
    expect(looksLikeOAuthToken("")).toBe(false);
  });

  it("never classifies the same credential as both", () => {
    for (const credential of [API_KEY, JWT, "garbage"]) {
      expect(
        looksLikeApiKey(credential) && looksLikeOAuthToken(credential),
      ).toBe(false);
    }
  });
});
