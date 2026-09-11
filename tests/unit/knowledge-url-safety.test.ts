import { describe, expect, it } from "vitest";

import { checkIngestUrl, isBlockedHostname, isBlockedIpAddress } from "@/features/knowledge/url-safety";

function reasonFor(url: string): string {
  const result = checkIngestUrl(url);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.reason;
}

describe("checkIngestUrl", () => {
  it("accepts public http and https URLs and drops the fragment", () => {
    const result = checkIngestUrl("  https://example.com/help/refunds?page=2#section  ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.href).toBe("https://example.com/help/refunds?page=2");
  });

  it("accepts the standard ports explicitly", () => {
    expect(checkIngestUrl("http://example.com:80/a").ok).toBe(true);
    expect(checkIngestUrl("https://example.com:443/a").ok).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/a.txt",
      "gopher://example.com/",
      "data:text/html,<p>hi</p>",
      "javascript:alert(1)",
    ]) {
      expect(reasonFor(url)).toContain("http");
    }
  });

  it("rejects blank and unparseable input", () => {
    expect(reasonFor("")).toContain("Enter a URL");
    expect(reasonFor("   ")).toContain("Enter a URL");
    expect(reasonFor("example.com/docs")).toContain("valid URL");
  });

  it("rejects embedded credentials", () => {
    expect(reasonFor("https://user:pass@example.com/")).toContain("credentials");
  });

  it("rejects non-standard ports", () => {
    expect(reasonFor("http://example.com:8080/admin")).toContain("standard http and https ports");
    expect(reasonFor("http://example.com:6379/")).toContain("standard http and https ports");
  });

  it("rejects every private, loopback and link-local range", () => {
    const blocked = [
      "http://localhost/",
      "http://localhost.localdomain.localhost/",
      "http://db.internal/",
      "http://printer.local/",
      "http://127.0.0.1/",
      "http://127.1.2.3/",
      "http://10.0.0.5/",
      "http://10.255.255.255/",
      "http://172.16.0.1/",
      "http://172.31.255.254/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://0.0.0.0/",
      "http://100.64.0.1/",
      "http://[::1]/",
      "http://[::]/",
      "http://[fe80::1]/",
      "http://[fc00::1]/",
      "http://[::ffff:127.0.0.1]/",
    ];
    for (const url of blocked) {
      expect(reasonFor(url), url).toContain("not publicly reachable");
    }
  });

  it("rejects decimal and hexadecimal spellings of loopback", () => {
    // The WHATWG URL parser normalizes these to dotted quads before we see them.
    expect(reasonFor("http://2130706433/")).toContain("not publicly reachable");
    expect(reasonFor("http://0x7f000001/")).toContain("not publicly reachable");
    expect(reasonFor("http://127.1/")).toContain("not publicly reachable");
  });

  it("allows public addresses just outside the blocked ranges", () => {
    for (const url of [
      "http://11.0.0.1/",
      "http://172.15.0.1/",
      "http://172.32.0.1/",
      "http://192.167.1.1/",
      "http://169.253.0.1/",
      "http://8.8.8.8/",
      "http://[2606:4700::1111]/",
    ]) {
      expect(checkIngestUrl(url).ok, url).toBe(true);
    }
  });
});

describe("isBlockedIpAddress", () => {
  it("blocks IPv4 special-use ranges", () => {
    for (const address of [
      "0.1.2.3",
      "10.1.2.3",
      "100.100.1.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.20.0.1",
      "192.0.0.1",
      "192.168.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isBlockedIpAddress(address), address).toBe(true);
    }
  });

  it("allows public IPv4 addresses", () => {
    for (const address of ["1.1.1.1", "8.8.4.4", "93.184.216.34", "172.15.255.255", "100.63.255.255"]) {
      expect(isBlockedIpAddress(address), address).toBe(false);
    }
  });

  it("blocks IPv6 loopback, unspecified, unique-local, link-local and multicast", () => {
    for (const address of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::abcd", "ff02::1", "[::1]", "fe80::1%eth0"]) {
      expect(isBlockedIpAddress(address), address).toBe(true);
    }
  });

  it("judges IPv4-mapped IPv6 by the embedded address", () => {
    expect(isBlockedIpAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isBlockedIpAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows global IPv6 addresses and ignores non-addresses", () => {
    expect(isBlockedIpAddress("2001:4860:4860::8888")).toBe(false);
    expect(isBlockedIpAddress("example.com")).toBe(false);
    expect(isBlockedIpAddress("not:an:address:at:all:x:y:z")).toBe(false);
  });
});

describe("isBlockedHostname", () => {
  it("blocks internal suffixes and single-label hosts", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("LOCALHOST.")).toBe(true);
    expect(isBlockedHostname("api.internal")).toBe(true);
    expect(isBlockedHostname("nas.home.arpa")).toBe(true);
    expect(isBlockedHostname("intranet")).toBe(true);
    expect(isBlockedHostname("")).toBe(true);
  });

  it("allows normal public hostnames", () => {
    expect(isBlockedHostname("example.com")).toBe(false);
    expect(isBlockedHostname("docs.example.co.uk")).toBe(false);
  });
});
