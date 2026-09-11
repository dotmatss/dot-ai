/**
 * Matches a request origin against a chatbot's allowed-domain list.
 * Supports exact hostnames, `*.example.com` wildcards (any depth) and
 * `localhost[:port]` for development. Scheme is ignored; port is only compared
 * when the allow-list entry specifies one.
 */
export function isOriginAllowed(origin: string | null | undefined, allowedDomains: readonly string[]): boolean {
  if (!origin || allowedDomains.length === 0) return false;
  let host: string;
  let port: string;
  try {
    const url = new URL(origin);
    host = url.hostname.toLowerCase();
    port = url.port;
  } catch {
    return false;
  }
  return allowedDomains.some((entry) => matchesEntry(host, port, entry.toLowerCase()));
}

function matchesEntry(host: string, port: string, entry: string): boolean {
  const [entryHost, entryPort] = entry.split(":");
  if (!entryHost) return false;
  if (entryPort !== undefined && entryPort !== port) return false;
  if (entryHost.startsWith("*.")) {
    const suffix = entryHost.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === entryHost;
}

export function originFromReferer(referer: string | null | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
