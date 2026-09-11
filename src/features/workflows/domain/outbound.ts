/**
 * Egress guard for the `tool.http_request` node.
 *
 * A workflow definition is authored by workspace members, so a URL in a node
 * config is untrusted input for the server that runs it. Three independent
 * conditions must hold before a real request is made: the step opts in
 * (`allowOutbound`), the host is on the step's allowlist, and the host is not
 * a loopback / link-local / private address. Blocking private ranges here
 * keeps a workflow from probing internal services (SSRF).
 *
 * Known limitation: a public hostname can still resolve to a private address
 * (DNS rebinding). Closing that gap requires resolving the name and pinning
 * the socket to the checked IP, which belongs in a shared outbound HTTP client
 * rather than in this feature.
 */

export type OutboundCheck = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a = 0, b = 0] = octets;
  if (a === 0 || a === 127) return true; // this-network and loopback
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

/** True for loopback, link-local, unique-local and private hosts. */
export function isBlockedOutboundHost(rawHostname: string): boolean {
  const hostname = rawHostname.trim().toLowerCase().replace(/\.$/, "");
  if (hostname.length === 0) return true;
  if (hostname === "localhost") return true;
  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;

  const ipv4 = parseIpv4(hostname);
  if (ipv4) return isPrivateIpv4(ipv4);

  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return isBlockedIpv6(hostname.slice(1, -1));
  }
  if (hostname.includes(":")) return isBlockedIpv6(hostname);
  return false;
}

function isBlockedIpv6(rawAddress: string): boolean {
  const address = rawAddress.split("%")[0]?.toLowerCase() ?? "";
  if (address === "" || address === "::" || address === "::1") return true;
  // IPv4-mapped and IPv4-compatible forms (::ffff:10.0.0.1) reuse the v4 rules.
  const mapped = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(address);
  if (mapped?.[1]) {
    const octets = parseIpv4(mapped[1]);
    if (octets && isPrivateIpv4(octets)) return true;
  }
  if (/^f[cd][0-9a-f]{0,2}:/.test(address)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]?:/.test(address)) return true; // fe80::/10 link local
  return false;
}

/** Exact host match, or a leading `*.` wildcard covering sub-domains only. */
export function hostMatchesAllowlist(hostname: string, allowedHosts: ReadonlyArray<string>): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((entry) => {
    const allowed = entry.trim().toLowerCase().replace(/\.$/, "");
    if (allowed.length === 0) return false;
    if (allowed.startsWith("*.")) return host.endsWith(allowed.slice(1)) && host.length > allowed.length - 1;
    return host === allowed;
  });
}

export function checkOutboundUrl(rawUrl: string, allowedHosts: ReadonlyArray<string>): OutboundCheck {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "The URL is not valid." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `Only http and https requests are allowed (got ${url.protocol.replace(":", "")}).` };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "Credentials in the URL are not allowed." };
  }
  if (allowedHosts.length === 0) {
    return { ok: false, reason: "Add the host to the step allowlist before enabling outbound requests." };
  }
  if (!hostMatchesAllowlist(url.hostname, allowedHosts)) {
    return { ok: false, reason: `“${url.hostname}” is not in the allowlist for this step.` };
  }
  if (isBlockedOutboundHost(url.hostname)) {
    return { ok: false, reason: `“${url.hostname}” resolves to a private or loopback address, which is never allowed.` };
  }
  return { ok: true, url };
}
