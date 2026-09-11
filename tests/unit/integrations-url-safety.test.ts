// @vitest-environment node
import { describe, expect, it } from "vitest";

import { checkWebhookUrl, isPublicHttpUrl } from "@/features/integrations/url-safety";

function reasonFor(url: string): string {
  const result = checkWebhookUrl(url);
  expect(result.ok, `expected ${url} to be rejected`).toBe(false);
  return result.ok ? "" : result.reason;
}

function expectBlocked(urls: string[]): void {
  for (const url of urls) {
    expect(checkWebhookUrl(url).ok, `expected ${url} to be rejected`).toBe(false);
  }
}

describe("checkWebhookUrl", () => {
  it("accepts public http and https endpoints", () => {
    expect(checkWebhookUrl("https://hooks.example.com/services/abc").ok).toBe(true);
    expect(checkWebhookUrl("http://example.com/hooks").ok).toBe(true);
    expect(checkWebhookUrl("  https://example.com/hooks  ").ok).toBe(true);
  });

  it("accepts the standard ports explicitly", () => {
    expect(checkWebhookUrl("http://example.com:80/hooks").ok).toBe(true);
    expect(checkWebhookUrl("https://example.com:443/hooks").ok).toBe(true);
  });

  it("rejects blank and unparseable input", () => {
    expect(reasonFor("")).toContain("Enter a URL");
    expect(reasonFor("   ")).toContain("Enter a URL");
    expect(reasonFor("example.com/hooks")).toContain("valid URL");
  });

  it("rejects every scheme but http and https", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "gopher://example.com/",
      "data:text/plain,hello",
      "javascript:alert(1)",
      "ws://example.com/socket",
    ]) {
      expect(reasonFor(url)).toContain("http");
    }
  });

  it("rejects embedded credentials", () => {
    expect(reasonFor("https://user:pass@example.com/hooks")).toContain("credentials");
    expect(reasonFor("https://user@example.com/hooks")).toContain("credentials");
  });

  it("rejects non-standard ports, which is how internal services are usually reached", () => {
    expect(reasonFor("http://example.com:8080/hooks")).toContain("ports");
    expect(reasonFor("https://example.com:5432/hooks")).toContain("ports");
  });

  it("rejects loopback in every spelling", () => {
    expectBlocked([
      "http://localhost/hooks",
      "http://localhost:80/hooks",
      "http://LOCALHOST/hooks",
      "http://api.localhost/hooks",
      "http://127.0.0.1/hooks",
      "http://127.1.2.3/hooks",
      "http://[::1]/hooks",
      "http://ip6-localhost/hooks",
    ]);
  });

  it("rejects link-local addresses, including the cloud metadata endpoint", () => {
    expectBlocked(["http://169.254.169.254/latest/meta-data/", "http://169.254.0.1/hooks", "http://[fe80::1]/hooks"]);
  });

  it("rejects RFC1918 private ranges", () => {
    expectBlocked([
      "http://10.0.0.1/hooks",
      "http://10.255.255.255/hooks",
      "http://172.16.0.1/hooks",
      "http://172.31.255.254/hooks",
      "http://192.168.0.1/hooks",
      "http://192.168.255.254/hooks",
    ]);
  });

  it("rejects the remaining non-routable ranges", () => {
    expectBlocked([
      "http://0.0.0.0/hooks", // "this network"
      "http://100.64.0.1/hooks", // carrier-grade NAT
      "http://192.0.0.1/hooks", // IETF protocol assignments
      "http://192.0.2.1/hooks", // TEST-NET-1
      "http://198.18.0.1/hooks", // benchmarking
      "http://224.0.0.1/hooks", // multicast
      "http://255.255.255.255/hooks", // broadcast
      "http://[fc00::1]/hooks", // unique local
      "http://[ff02::1]/hooks", // multicast
      "http://[::]/hooks", // unspecified
      "http://[::ffff:127.0.0.1]/hooks", // IPv4-mapped loopback
      "http://[::ffff:10.0.0.1]/hooks", // IPv4-mapped private
    ]);
  });

  it("rejects internal-only hostname suffixes and single-label names", () => {
    expectBlocked([
      "http://db.internal/hooks",
      "http://printer.local/hooks",
      "http://router.home.arpa/hooks",
      "http://intranet/hooks",
      "http://intranet./hooks",
    ]);
  });

  it("still allows public addresses that merely look adjacent to private ones", () => {
    for (const url of [
      "http://11.0.0.1/hooks",
      "http://172.15.0.1/hooks",
      "http://172.32.0.1/hooks",
      "http://192.169.0.1/hooks",
      "http://100.63.0.1/hooks",
      "http://8.8.8.8/hooks",
      "https://example.internal.com/hooks",
    ]) {
      expect(checkWebhookUrl(url).ok, `expected ${url} to be allowed`).toBe(true);
    }
  });

  it("exposes the same policy as a predicate for schemas", () => {
    expect(isPublicHttpUrl("https://hooks.example.com/x")).toBe(true);
    expect(isPublicHttpUrl("http://169.254.169.254/")).toBe(false);
  });
});
