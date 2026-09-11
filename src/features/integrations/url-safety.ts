import { isBlockedHostname } from "@/features/knowledge/url-safety";

/**
 * Destination policy for outbound calls the server makes on a user's behalf
 * (webhook delivery, Slack incoming webhooks, connection tests).
 *
 * The address predicates are reused from the knowledge importer rather than
 * re-derived here: parsing IPv4/IPv6 literals and classifying every
 * non-routable range is exactly the kind of code that must have one
 * implementation and one test suite. They belong in shared `src/lib`; see the
 * note in the feature report.
 *
 * This module adds the policy that differs for integrations: a webhook URL is
 * stored and replayed later, so it is validated when it is saved *and* again on
 * every redirect hop at delivery time.
 */

export type WebhookUrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function checkWebhookUrl(input: string): WebhookUrlCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "Enter a URL." };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That is not a valid URL. Include the scheme, for example https://example.com/hooks/dot." };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: "Only http:// and https:// endpoints can receive webhooks." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not allowed." };
  }
  // A public hostname on an unusual port is the common way to tunnel to an
  // internal service, and the address checks below cannot see through it.
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { ok: false, reason: "Only the standard http and https ports are allowed." };
  }
  if (isBlockedHostname(url.hostname)) {
    return {
      ok: false,
      reason: "That host is not publicly reachable. Loopback, link-local and private addresses cannot receive webhooks.",
    };
  }

  return { ok: true, url };
}

/** True when a URL is an acceptable webhook destination. Used by the registry's Zod schemas. */
export function isPublicHttpUrl(input: string): boolean {
  return checkWebhookUrl(input).ok;
}
