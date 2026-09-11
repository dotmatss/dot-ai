import { describe, expect, it } from "vitest";

import { MAX_USER_AGENT_DISPLAY_LENGTH } from "@/features/settings/constants";
import { describeUserAgent, truncateUserAgent, UNKNOWN_DEVICE_LABEL } from "@/features/settings/user-agent";

const AGENTS = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  operaWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  firefoxAndroid: "Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/119.0 Firefox/119.0",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  safariIpad:
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
} as const;

describe("describeUserAgent", () => {
  it("names the browser and the operating system", () => {
    expect(describeUserAgent(AGENTS.chromeMac)).toEqual({
      browser: "Chrome",
      operatingSystem: "macOS",
      label: "Chrome on macOS",
    });
  });

  it("prefers the more specific browser token over the one every Chromium claims", () => {
    // Every Chromium browser also says "Chrome/", and every iOS browser also
    // says "Safari"; the specific token has to win or everything is Chrome.
    expect(describeUserAgent(AGENTS.edgeWindows).browser).toBe("Edge");
    expect(describeUserAgent(AGENTS.operaWindows).browser).toBe("Opera");
    expect(describeUserAgent(AGENTS.samsungAndroid).browser).toBe("Samsung Internet");
    expect(describeUserAgent(AGENTS.chromeIos).browser).toBe("Chrome");
    expect(describeUserAgent(AGENTS.safariIphone).browser).toBe("Safari");
  });

  it("prefers the more specific operating system token", () => {
    // Android also says "Linux"; iPhone and iPad also say "Mac OS X".
    expect(describeUserAgent(AGENTS.samsungAndroid).operatingSystem).toBe("Android");
    expect(describeUserAgent(AGENTS.firefoxAndroid).operatingSystem).toBe("Android");
    expect(describeUserAgent(AGENTS.safariIphone).operatingSystem).toBe("iOS");
    expect(describeUserAgent(AGENTS.safariIpad).operatingSystem).toBe("iPadOS");
    expect(describeUserAgent(AGENTS.firefoxLinux).operatingSystem).toBe("Linux");
    expect(describeUserAgent(AGENTS.edgeWindows).operatingSystem).toBe("Windows");
  });

  it("labels with whichever half it recognised", () => {
    expect(describeUserAgent("Chrome/120.0.0.0").label).toBe("Chrome");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)").label).toBe("Windows");
  });

  it("falls back to a label rather than rendering an empty device", () => {
    for (const value of [null, undefined, "", "   ", "curl/8.4.0"]) {
      expect(describeUserAgent(value)).toEqual({
        browser: null,
        operatingSystem: null,
        label: UNKNOWN_DEVICE_LABEL,
      });
    }
  });

  it("does not read meaning into attacker-controlled text beyond the label", () => {
    const hostile = "<script>alert(1)</script> Chrome/1.0 (Windows NT 10.0)";
    expect(describeUserAgent(hostile).label).toBe("Chrome on Windows");
  });
});

describe("truncateUserAgent", () => {
  it("returns null for an absent or blank agent so the UI can omit the line", () => {
    expect(truncateUserAgent(null)).toBeNull();
    expect(truncateUserAgent(undefined)).toBeNull();
    expect(truncateUserAgent("")).toBeNull();
    expect(truncateUserAgent("   \n  ")).toBeNull();
  });

  it("collapses runs of whitespace", () => {
    expect(truncateUserAgent("  Mozilla/5.0   (X11;\n Linux)  ")).toBe("Mozilla/5.0 (X11; Linux)");
  });

  it("leaves a short agent alone", () => {
    expect(truncateUserAgent("curl/8.4.0")).toBe("curl/8.4.0");
  });

  it("caps one pathological header so it cannot stretch a table row", () => {
    const truncated = truncateUserAgent("a".repeat(512)) ?? "";
    expect(truncated.length).toBe(MAX_USER_AGENT_DISPLAY_LENGTH);
    expect(truncated.endsWith("…")).toBe(true);
  });

  it("honours a caller-supplied cap", () => {
    expect(truncateUserAgent("abcdefghij", 5)).toBe("abcd…");
  });

  it("does not leave dangling whitespace before the ellipsis", () => {
    expect(truncateUserAgent("abcd efghij", 6)).toBe("abcd…");
  });
});
