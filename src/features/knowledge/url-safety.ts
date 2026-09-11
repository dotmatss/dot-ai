/**
 * SSRF guards for URL ingestion.
 *
 * Fetching a user-supplied URL from the server turns the app into a proxy with
 * network access the caller does not have: cloud metadata endpoints, internal
 * admin panels and databases all live on addresses the browser could never
 * reach. These predicates are pure so they can be unit tested exhaustively and
 * reused on every redirect hop and on every DNS-resolved address, not just on
 * the URL the user typed.
 */

export interface UrlCheckFailure {
  ok: false;
  reason: string;
}

export interface UrlCheckSuccess {
  ok: true;
  url: URL;
}

export type UrlCheckResult = UrlCheckSuccess | UrlCheckFailure;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Hostnames that never resolve to public infrastructure. */
const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];
const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return null;
  const octets = match.slice(1, 5).map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  return [a, b, c, d];
}

/** Expands an IPv6 literal (with optional "::" and trailing IPv4) to 8 groups. */
function parseIpv6(input: string): number[] | null {
  const hostname = input.replace(/^\[/, "").replace(/\]$/, "").split("%")[0] ?? "";
  if (!hostname.includes(":")) return null;

  let head = hostname;
  let tail = "";
  if (hostname.includes("::")) {
    const parts = hostname.split("::");
    if (parts.length !== 2) return null;
    head = parts[0] ?? "";
    tail = parts[1] ?? "";
  }

  const toGroups = (section: string): number[] | null => {
    if (!section) return [];
    const groups: number[] = [];
    const pieces = section.split(":");
    for (let index = 0; index < pieces.length; index++) {
      const piece = pieces[index] ?? "";
      if (piece.includes(".")) {
        // IPv4-mapped / IPv4-compatible tail, e.g. ::ffff:127.0.0.1
        if (index !== pieces.length - 1) return null;
        const octets = parseIpv4(piece);
        if (!octets) return null;
        groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      groups.push(Number.parseInt(piece, 16));
    }
    return groups;
  };

  const headGroups = toGroups(head);
  const tailGroups = toGroups(tail);
  if (!headGroups || !tailGroups) return null;

  if (!hostname.includes("::")) {
    return headGroups.length === 8 ? headGroups : null;
  }
  const fill = 8 - headGroups.length - tailGroups.length;
  if (fill < 0) return null;
  return [...headGroups, ...Array.from({ length: fill }, () => 0), ...tailGroups];
}

/**
 * True for loopback, link-local, private, carrier-grade-NAT, multicast and
 * otherwise non-routable addresses in either family.
 */
export function isBlockedIpAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) {
    const [a, b] = ipv4;
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a === 169 && b === 254) return true; // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 special use
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast, reserved, broadcast
    return false;
  }

  const groups = parseIpv6(address);
  if (!groups) return false;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const isZeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (isZeroPrefix && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1 loopback
  if (isZeroPrefix && g5 === 0 && g6 === 0 && g7 === 0) return true; // :: unspecified
  if (isZeroPrefix && g5 === 0xffff) {
    // IPv4-mapped: judge the embedded IPv4 address.
    return isBlockedIpAddress(`${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`);
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** True when a hostname must never be fetched, independent of DNS. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // Single-label hostnames only resolve through internal search domains.
  if (!host.includes(".") && !host.includes(":")) return true;
  return isBlockedIpAddress(host);
}

/**
 * Validates and normalizes a URL for server-side ingestion. Called on the URL
 * the user submitted and again on every redirect target.
 */
export function checkIngestUrl(input: string): UrlCheckResult {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "Enter a URL to import." };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That is not a valid URL. Include the scheme, for example https://example.com/docs." };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: "Only http:// and https:// URLs can be imported." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not allowed." };
  }
  // Non-standard ports are how internal services are usually reached; the
  // hostname checks below cover addresses, this covers public hosts that
  // tunnel to private ones.
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { ok: false, reason: "Only the standard http and https ports are allowed." };
  }
  if (isBlockedHostname(url.hostname)) {
    return {
      ok: false,
      reason: "That host is not publicly reachable. Private, loopback and link-local addresses cannot be imported.",
    };
  }

  url.hash = "";
  return { ok: true, url };
}
