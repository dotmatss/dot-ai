import "server-only";

import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";

import { Agent, fetch as undiciFetch } from "undici";

import { isBlockedIpAddress } from "@/features/knowledge/url-safety";
import { checkWebhookUrl } from "@/features/integrations/url-safety";

/**
 * One guarded outbound HTTP path for requests the server makes to a
 * destination a customer configured.
 *
 * This is the single implementation of those controls. The address
 * classification and the DNS check must not be copied per caller, so the
 * integration connection tester, the knowledge URL importer and the MCP client
 * all come through here.
 *
 * The controls, in order:
 *
 *  1. Scheme, embedded credentials, port and literal-address policy, via
 *     `checkWebhookUrl` (or a caller's equivalent, see `checkUrl`).
 *  2. DNS resolution checked against the same address policy, which closes the
 *     gap where a public name resolves into private space.
 *  3. The socket is pinned to the addresses that step 2 validated, so the
 *     connection cannot land somewhere else. See below.
 *  4. Redirects followed manually with 1-3 re-applied to every hop. An open
 *     redirect is the usual way to smuggle a request to 169.254.169.254.
 *  5. One wall-clock budget for the whole exchange, redirects included.
 *  6. A response size cap, so a hostile server cannot exhaust memory through a
 *     body we are going to parse.
 *
 * On the pinning in step 3: validating a name and then handing the *name* to
 * the HTTP client leaves a window between the check and the connection, because
 * the client resolves the name a second time and it is that second answer which
 * decides where the socket goes. A DNS server that returns a public address and
 * then a private one walks straight through a check that only looks at the
 * first answer. We close that window by resolving once and connecting to the
 * addresses we already validated: the request carries the original hostname in
 * the URL and the Host header, and only the destination address is fixed.
 *
 * What this does NOT claim: it is not protection against every network-level
 * attack. It fixes the address, so it cannot help against a network path that
 * is hostile at a lower layer than DNS (ARP or BGP interference, a compromised
 * resolver returning a public address that is itself attacker-controlled, or a
 * proxy in front of us). TLS certificate verification for https, which is left
 * at its default, is what makes the pinned address prove its identity.
 */

/** An address that passed the policy, with the family the connector needs. */
export interface ValidatedAddress {
  address: string;
  /** 4 or 6, taken from the resolver so IPv6 destinations still work. */
  family: number;
}

export type DestinationCheck = { ok: true; addresses: ValidatedAddress[] } | { ok: false; reason: string };

/**
 * Resolves a hostname and rejects it if any address is non-routable, returning
 * the addresses so the caller can connect to exactly what was checked.
 *
 * Every address is checked, not just the first: a name that resolves to one
 * public and one private address must be refused, or the choice of which to
 * connect to decides whether the guard held.
 */
export async function assertPublicDestination(hostname: string): Promise<DestinationCheck> {
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "");
  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: `Could not resolve ${hostname}.` };
  }
  if (resolved.length === 0) return { ok: false, reason: `Could not resolve ${hostname}.` };
  if (resolved.some((entry) => isBlockedIpAddress(entry.address))) {
    return { ok: false, reason: `${hostname} resolves to a private address, which cannot be called.` };
  }
  return { ok: true, addresses: resolved.map(({ address, family }) => ({ address, family })) };
}

/**
 * Why a request was refused. Callers phrase their own user-facing message from
 * this rather than matching on text.
 */
export type EgressBlockKind = "url" | "dns" | "redirect-limit" | "redirect-location" | "size" | "pin";

export class EgressBlockedError extends Error {
  readonly kind: EgressBlockKind;
  /** 0 for the URL the caller asked for, 1+ for a redirect target. */
  readonly hop: number;

  constructor(reason: string, kind: EgressBlockKind = "url", hop = 0) {
    super(reason);
    this.name = "EgressBlockedError";
    this.kind = kind;
    this.hop = hop;
  }
}

/** A URL policy: the shape both `checkWebhookUrl` and `checkIngestUrl` return. */
export type UrlPolicy = (input: string) => { ok: true; url: URL } | { ok: false; reason: string };

export interface GuardedFetchOptions {
  /** Total budget for the exchange, redirects included. */
  timeoutMs: number;
  /** Redirect hops allowed before giving up. */
  maxRedirects?: number;
  /**
   * Cap on a response body we will read, in bytes. Pass
   * `Number.POSITIVE_INFINITY` only when the body is discarded unread.
   */
  maxResponseBytes?: number;
  /** Require https. Http is only ever sensible in local development. */
  requireHttps?: boolean;
  /**
   * A caller's own URL policy, used so its refusals are worded for its own
   * users. It narrows the rules, never widens them: `checkWebhookUrl` is still
   * applied as a floor.
   */
  checkUrl?: UrlPolicy;
}

const DEFAULTS = { maxRedirects: 2, maxResponseBytes: 4_000_000, requireHttps: true } as const;

type UndiciResponse = Awaited<ReturnType<typeof undiciFetch>>;
type UndiciRequestInit = NonNullable<Parameters<typeof undiciFetch>[1]>;

/**
 * A dispatcher whose connections can only go to `addresses`.
 *
 * A fresh one per request, deliberately: a pooled connection outlives the check
 * that authorised it, and reusing a socket would mean a later request inherits
 * an earlier request's destination. The cost is a new connection each time.
 */
interface Pin {
  agent: Agent;
  /** True once the connector asked us for an address, proving the pin was in force. */
  applied: () => boolean;
  release: () => void;
}

function pinTo(addresses: ValidatedAddress[]): Pin {
  let applied = false;

  const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
    applied = true;
    // The connector asks with `all: true`, so it expects the array form. Every
    // validated address is offered, in resolver order, which keeps dual-stack
    // and failover behaviour intact.
    callback(
      null,
      addresses.map(({ address, family }) => ({ address, family })),
    );
  };

  const agent = new Agent({ connect: { lookup: pinnedLookup } });

  return {
    agent,
    applied: () => applied,
    release: () => void agent.close().catch(() => undefined),
  };
}

/**
 * Wraps a body stream so it cannot exceed `limit` bytes, and releases the
 * dispatcher once the body is finished, cancelled or errored. Releasing earlier
 * would cut off a response that is still being read.
 */
function capped(
  source: ReadableStream<Uint8Array>,
  limit: number | null,
  release: () => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let seen = 0;
  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    release();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          finish();
          return;
        }
        if (limit !== null) {
          seen += next.value.byteLength;
          if (seen > limit) {
            await reader.cancel().catch(() => undefined);
            controller.error(new EgressBlockedError(`The response was larger than the ${limit} byte limit.`, "size"));
            finish();
            return;
          }
        }
        controller.enqueue(next.value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      finish();
    },
  });
}

/**
 * Turns undici's response into a platform `Response`.
 *
 * The re-wrap is not cosmetic: undici's classes are not the global ones, and a
 * library that checks `response instanceof Response` (the MCP SDK does) would
 * reject them. Headers are copied entry by entry, which preserves repeated
 * headers such as set-cookie.
 */
function finalize(response: UndiciResponse, limit: number, pin: Pin, finalUrl: string): Response {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limit) {
    void response.body?.cancel().catch(() => undefined);
    pin.release();
    throw new EgressBlockedError(`The response was larger than the ${limit} byte limit.`, "size");
  }

  // An event stream stays open by design and its total size is not meaningful;
  // the wall-clock budget is what bounds it. Counting bytes here would kill a
  // legitimate long-lived stream.
  const isEventStream = (response.headers.get("content-type") ?? "").includes("text/event-stream");
  const headers: Array<[string, string]> = [...response.headers];

  let body: ReadableStream<Uint8Array> | null = null;
  if (response.body) {
    // undici types its body as `ReadableStream<any>`; at runtime it is a
    // platform stream of Uint8Array chunks, which the contract test asserts.
    body = capped(response.body as ReadableStream<Uint8Array>, isEventStream ? null : limit, pin.release);
  } else {
    pin.release();
  }

  const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers });
  // A constructed Response has an empty `url`; a real fetch exposes the final
  // destination there, and callers read it to report where they ended up.
  Object.defineProperty(wrapped, "url", { value: finalUrl, enumerable: true, configurable: true });
  return wrapped;
}

/**
 * Builds a `fetch`-shaped function that enforces the controls above.
 *
 * The signature is deliberately `(url, init) => Promise<Response>` so it can be
 * handed to a library that expects a standard fetch. The MCP SDK's Streamable
 * HTTP transport takes exactly that as its `fetch` option, documented as being
 * used for all network requests, which is what keeps these controls inside the
 * MCP request path rather than beside it.
 */
export function createGuardedFetch(options: GuardedFetchOptions): (url: string | URL, init?: RequestInit) => Promise<Response> {
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULTS.maxResponseBytes;
  const requireHttps = options.requireHttps ?? DEFAULTS.requireHttps;
  const checkUrl = options.checkUrl;

  return async function guardedFetch(url: string | URL, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    // A caller's own signal must still cancel us: an abandoned agent turn
    // should not leave a request running against a customer's server.
    const callerSignal = init?.signal;
    const onCallerAbort = () => controller.abort();
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

    try {
      let target = typeof url === "string" ? url : url.toString();

      for (let hop = 0; hop <= maxRedirects; hop++) {
        // The shared policy is always applied. A caller's own policy runs first
        // so its wording reaches its users, but it cannot let anything through
        // that this would refuse.
        const policy = checkUrl ? checkUrl(target) : checkWebhookUrl(target);
        if (!policy.ok) throw new EgressBlockedError(policy.reason, "url", hop);
        if (checkUrl) {
          const floor = checkWebhookUrl(target);
          if (!floor.ok) throw new EgressBlockedError(floor.reason, "url", hop);
        }
        if (requireHttps && policy.url.protocol !== "https:") {
          throw new EgressBlockedError("Only https:// endpoints are allowed.", "url", hop);
        }

        const destination = await assertPublicDestination(policy.url.hostname);
        if (!destination.ok) throw new EgressBlockedError(destination.reason, "dns", hop);

        const pin = pinTo(destination.addresses);

        let response: UndiciResponse;
        try {
          response = await undiciFetch(policy.url, {
            ...(init as unknown as UndiciRequestInit),
            dispatcher: pin.agent,
            redirect: "manual",
            signal: controller.signal,
            cache: "no-store",
          });
        } catch (error) {
          pin.release();
          throw error;
        }

        // Defence in depth rather than the pin itself: if the dispatcher were
        // ever ignored, the connection would have been made to an address we
        // never validated, so the response is refused instead of returned.
        if (!pin.applied()) {
          await response.body?.cancel().catch(() => undefined);
          pin.release();
          throw new EgressBlockedError("The request did not use the validated address, so it was refused.", "pin", hop);
        }

        if (response.status < 300 || response.status >= 400) {
          return finalize(response, maxResponseBytes, pin, policy.url.toString());
        }

        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        pin.release();
        if (!location) {
          throw new EgressBlockedError("The server returned a redirect without a destination.", "redirect-location", hop);
        }
        if (hop === maxRedirects) {
          throw new EgressBlockedError("The server redirected too many times.", "redirect-limit", hop);
        }
        target = new URL(location, policy.url).toString();
      }

      throw new EgressBlockedError("The server redirected too many times.", "redirect-limit", maxRedirects);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  };
}
