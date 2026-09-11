import "server-only";

import { createHmac } from "node:crypto";

import { INTEGRATION_TEST_TIMEOUT_MS } from "@/features/integrations/constants";
import { checkWebhookUrl } from "@/features/integrations/url-safety";
import { createGuardedFetch, EgressBlockedError } from "@/server/http/egress-guard";

/**
 * Server-side delivery of a test payload.
 *
 * The request originates inside our network, so the destination is untrusted
 * input in the strongest sense. The destination policy, the DNS check, the
 * pinning of the socket to the validated address and the per-hop redirect
 * re-validation are all the shared egress guard's, because that logic must have
 * one implementation and one test suite rather than a copy per caller.
 *
 * What remains here is what is specific to delivering a test payload: the
 * signature scheme, and the wording of the result.
 *
 * The response body is discarded, never parsed and never echoed back, so a
 * caller cannot use this as a read proxy for internal services. The returned
 * message names the host and the status code only. It never contains the URL (a
 * Slack incoming webhook URL is itself a credential), the signing secret, or
 * any response content.
 */

const MAX_REDIRECTS = 2;
const USER_AGENT = "dot-integrations/1.0";

const deliver = createGuardedFetch({
  timeoutMs: INTEGRATION_TEST_TIMEOUT_MS,
  maxRedirects: MAX_REDIRECTS,
  // The body is cancelled unread, so there is nothing to cap. A receiver that
  // answers a test ping with a large body is odd, not dangerous.
  maxResponseBytes: Number.POSITIVE_INFINITY,
  // `checkWebhookUrl` permits http, which is the only way to test a receiver in
  // local development. The address policy still applies to it.
  requireHttps: false,
});

export interface DeliveryResult {
  ok: boolean;
  message: string;
}

/** Signature scheme documented for webhook receivers: HMAC-SHA256 over `timestamp.body`. */
export function signPayload(body: string, secret: string, timestampSeconds: number): string {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
}

export interface PostPayloadOptions {
  url: string;
  body: unknown;
  signingSecret?: string | undefined;
  /** Used in the result message instead of the host when the URL itself is a secret. */
  displayName?: string;
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Phrases a refusal without ever including the URL or the response body. */
function failureMessage(error: unknown, label: string): string {
  if (error instanceof EgressBlockedError) {
    switch (error.kind) {
      case "redirect-limit":
        return `${label} redirects too many times.`;
      case "redirect-location":
        return `${label} returned a redirect without a destination.`;
      default:
        // A refusal on a later hop is a refusal of where the receiver sent us,
        // which is worth distinguishing from a bad URL.
        return error.hop > 0
          ? `${label} redirects to a location that cannot be called. ${error.message}`
          : error.message;
    }
  }
  if (error instanceof Error && error.name === "AbortError") {
    return `${label} did not respond within ${INTEGRATION_TEST_TIMEOUT_MS / 1000} seconds.`;
  }
  return `Could not reach ${label}: ${error instanceof Error ? error.message : "request failed"}.`;
}

export async function postTestPayload(options: PostPayloadOptions): Promise<DeliveryResult> {
  const initial = checkWebhookUrl(options.url);
  if (!initial.ok) return { ok: false, message: initial.reason };

  const serialized = JSON.stringify(options.body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "X-Dot-Event": "integration.test",
  };
  if (options.signingSecret) {
    const timestamp = Math.floor(Date.now() / 1000);
    headers["X-Dot-Signature"] = `t=${timestamp},v1=${signPayload(serialized, options.signingSecret, timestamp)}`;
  }

  // After a redirect the interesting host is the one that answered, so the
  // label prefers the final URL when there is one.
  const label = (finalUrl?: string) => options.displayName ?? hostOf(finalUrl) ?? initial.url.hostname;

  try {
    const response = await deliver(options.url, { method: "POST", headers, body: serialized });

    // Nothing in the body is trusted or needed; release the socket immediately.
    await response.body?.cancel().catch(() => undefined);

    const who = label(response.url);
    return response.ok
      ? { ok: true, message: `${who} accepted the test payload (HTTP ${response.status}).` }
      : { ok: false, message: `${who} responded with HTTP ${response.status}.` };
  } catch (error) {
    return { ok: false, message: failureMessage(error, label()) };
  }
}
