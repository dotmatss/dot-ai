import { describe, expect, it } from "vitest";

import { isOriginAllowed, originFromReferer } from "@/features/embed/server/domain-match";

describe("isOriginAllowed", () => {
  const allowed = ["example.com", "*.shop.example.org", "localhost:3000"];

  it("matches exact hostnames regardless of scheme", () => {
    expect(isOriginAllowed("https://example.com", allowed)).toBe(true);
    expect(isOriginAllowed("http://example.com", allowed)).toBe(true);
  });

  it("rejects subdomains unless a wildcard is configured", () => {
    expect(isOriginAllowed("https://www.example.com", allowed)).toBe(false);
    expect(isOriginAllowed("https://eu.shop.example.org", allowed)).toBe(true);
    expect(isOriginAllowed("https://a.b.shop.example.org", allowed)).toBe(true);
    expect(isOriginAllowed("https://shop.example.org", allowed)).toBe(false);
  });

  it("compares ports only when the allow-list entry has one", () => {
    expect(isOriginAllowed("http://localhost:3000", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:4000", allowed)).toBe(false);
  });

  it("rejects lookalike suffixes and garbage", () => {
    expect(isOriginAllowed("https://notexample.com", allowed)).toBe(false);
    expect(isOriginAllowed("https://example.com.evil.net", allowed)).toBe(false);
    expect(isOriginAllowed("not a url", allowed)).toBe(false);
    expect(isOriginAllowed(null, allowed)).toBe(false);
    expect(isOriginAllowed("https://example.com", [])).toBe(false);
  });
});

describe("originFromReferer", () => {
  it("extracts the origin and tolerates missing or invalid values", () => {
    expect(originFromReferer("https://www.acme.com/pricing?x=1")).toBe("https://www.acme.com");
    expect(originFromReferer(null)).toBeNull();
    expect(originFromReferer("garbage")).toBeNull();
  });
});
