import "server-only";

import { lookup } from "node:dns/promises";
import { createHmac } from "node:crypto";

import { INTEGRATION_TEST_TIMEOUT_MS } from "@/features/integrations/constants";
import { isBlockedIpAddress } from "@/features/knowledge/url-safety";
import { checkWebhookUrl } from "@/features/integrations/url-safety";

/**
 * Server-side delivery of a test payload.
 *
 * The request originates inside our network, so the destination is untrusted
 * input in the strongest sense. Controls, in order:
 *
 *  1. scheme, credential, port and literal-address policy (`checkWebhookUrl`);
 *  2. DNS resolution checked against the same address policy, closing the gap
 *     where a public name points at private space;
 *  3. redirects followed manually, with 1 and 2 re-applied to every hop -
 *     an open redirect is the usual way to smuggle a request to 169.254.169.254;
 *  4. one wall-clock budget for the whole exchange, redirects included;
 *  5. the response body is discarded, never parsed and never echoed back, so a
 *     caller cannot use this as a read proxy for internal services.
 *
 * The returned message names the host and the status code only. It never
 * contains the URL (a Slack incoming webhook URL is itself a credential), the
 * signing secret, or any response content.
 */

const MAX_REDIRECTS = 2;
const USER_AGENT = "dot-integrations/1.0";

export interface DeliveryResult {
  ok: boolean;
  message: string;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "");
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new DeliveryError(`Could not resolve ${hostname}.`);
  }
  if (addresses.length === 0) throw new DeliveryError(`Could not resolve ${hostname}.`);
  if (addresses.some((entry) => isBlockedIpAddress(entry.address))) {
    throw new DeliveryError(`${hostname} resolves to a private address, which cannot be called.`);
  }
}

class DeliveryError extends Error {}

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTEGRATION_TEST_TIMEOUT_MS);
  let target = initial.url;
  const label = () => options.displayName ?? target.hostname;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(target.hostname);

      let response: Response;
      try {
        response = await fetch(target, {
          method: "POST",
          headers,
          body: serialized,
          redirect: "manual",
          signal: controller.signal,
          cache: "no-store",
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return { ok: false, message: `${label()} did not respond within ${INTEGRATION_TEST_TIMEOUT_MS / 1000} seconds.` };
        }
        return { ok: false, message: `Could not reach ${label()}: ${error instanceof Error ? error.message : "request failed"}.` };
      }

      // Nothing in the body is trusted or needed; release the socket immediately.
      await response.body?.cancel().catch(() => undefined);

      if (response.status < 300 || response.status >= 400) {
        return response.ok
          ? { ok: true, message: `${label()} accepted the test payload (HTTP ${response.status}).` }
          : { ok: false, message: `${label()} responded with HTTP ${response.status}.` };
      }

      const location = response.headers.get("location");
      if (!location) return { ok: false, message: `${label()} returned a redirect without a destination.` };
      if (hop === MAX_REDIRECTS) return { ok: false, message: `${label()} redirects too many times.` };

      const next = checkWebhookUrl(new URL(location, target).href);
      if (!next.ok) return { ok: false, message: `${label()} redirects to a location that cannot be called. ${next.reason}` };
      target = next.url;
    }
    return { ok: false, message: `${label()} redirects too many times.` };
  } catch (error) {
    if (error instanceof DeliveryError) return { ok: false, message: error.message };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
