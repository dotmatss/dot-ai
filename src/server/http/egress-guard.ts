import "server-only";

import { resolve4, resolve6 } from "node:dns/promises";

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
 * The controls, in order, applied per request and again to every redirect hop:
 *
 *  1. Scheme, embedded credentials, port and literal-address policy, via
 *     `checkWebhookUrl` (or a caller's equivalent, see `checkUrl`).
 *  2. The name is resolved and **every** returned address is checked against
 *     the private-address policy. One public and one private answer is a
 *     refusal, not a choice.
 *  3. Redirects followed manually so 1 and 2 apply to each hop. An open
 *     redirect is the usual way to smuggle a request to 169.254.169.254.
 *  4. One wall-clock budget for the whole exchange, redirects included.
 *  5. A response size cap, so a hostile server cannot exhaust memory through a
 *     body we are going to parse.
 *
 * ## KNOWN LIMITATION: the destination is validated, not pinned
 *
 * Step 2 validates a **name**. Step 3 connects by handing that same name to
 * `fetch`, which resolves it again. The decision and the connection therefore
 * rest on two separate DNS answers, and a resolver under an attacker's control
 * can answer the first with a public address and the second with a private one.
 * This is a time-of-check-to-time-of-use window and it is open.
 *
 * It was closed once. Phase 2a pinned the socket to the validated address with
 * a per-request `undici.Agent({ connect: { lookup } })`. That was removed
 * deliberately when the deployment target became Cloudflare Workers, which
 * offers no way to fix a connection to a chosen address: the platform `fetch`
 * is the runtime's own and accepts no custom dispatcher. `dns.lookup()` is not
 * available there either, which is why this file uses `resolve4`/`resolve6`.
 *
 * **Do not re-introduce pinning here without checking the deployment target
 * first.** On Workers it cannot work; on a Node runtime it can, and the history
 * is in `docs/mcp-phase2-gate.md` phase 2a. The decision to accept this window
 * is recorded in `docs/deployment.md`.
 *
 * What remains is genuine and is not nothing: the scheme and port policy, the
 * refusal of private literals, the per-address check on the resolved answer,
 * and the per-hop re-validation of redirects. The MCP specification's own
 * guidance names this exact residual window and recommends combining DNS
 * checks with other mitigations, which is what the layers above are.
 */

export type DestinationCheck = { ok: true } | { ok: false; reason: string };

/**
 * Resolves a hostname and rejects it if any address is non-routable.
 *
 * Both families are queried and the answers are combined, because a name that
 * resolves to one public and one private address must be refused outright: if
 * only one family were checked, which address the runtime happened to connect
 * to would decide whether the guard held.
 *
 * Deliberately returns no addresses. Nothing can be done with them — the
 * connection is made by name — and handing them back would imply a pinning
 * capability this does not have.
 */
export async function assertPublicDestination(hostname: string): Promise<DestinationCheck> {
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "");

  // `resolve4`/`resolve6` rather than `lookup`: `lookup` throws "Not
  // implemented" on the Workers runtime. These query A and AAAA records
  // directly, which the recursive resolver answers through any CNAME chain.
  const [v4, v6] = await Promise.all([
    resolve4(host).catch(() => [] as string[]),
    resolve6(host).catch(() => [] as string[]),
  ]);
  const addresses = [...v4, ...v6];

  if (addresses.length === 0) return { ok: false, reason: `Could not resolve ${hostname}.` };
  if (addresses.some((address) => isBlockedIpAddress(address))) {
    return { ok: false, reason: `${hostname} resolves to a private address, which cannot be called.` };
  }
  return { ok: true };
}

/**
 * Why a request was refused. Callers phrase their own user-facing message from
 * this rather than matching on text.
 */
export type EgressBlockKind = "url" | "dns" | "redirect-limit" | "redirect-location" | "size";

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

/**
 * Wraps a body stream so it cannot exceed `limit` bytes, and records the final
 * URL so a caller can report where it ended up.
 */
function finalize(response: Response, limit: number, finalUrl: string): Response {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limit) {
    void response.body?.cancel().catch(() => undefined);
    throw new EgressBlockedError(`The response was larger than the ${limit} byte limit.`, "size");
  }

  // An event stream stays open by design and its total size is not meaningful;
  // the wall-clock budget is what bounds it. Counting bytes here would kill a
  // legitimate long-lived stream.
  const isEventStream = (response.headers.get("content-type") ?? "").includes("text/event-stream");

  let result = response;

  if (response.body && !isEventStream && Number.isFinite(limit)) {
    let seen = 0;
    const limited = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          seen += chunk.byteLength;
          if (seen > limit) {
            controller.error(new EgressBlockedError(`The response was larger than the ${limit} byte limit.`, "size"));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    result = new Response(limited, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  // A constructed Response has an empty `url`, and callers read it to report
  // the final destination after redirects. Defined explicitly so the value is
  // the same whether or not the body was re-wrapped above.
  Object.defineProperty(result, "url", { value: finalUrl, enumerable: true, configurable: true });
  return result;
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

        const response = await fetch(policy.url, {
          ...init,
          redirect: "manual",
          signal: controller.signal,
          cache: "no-store",
        });

        if (response.status < 300 || response.status >= 400) {
          return finalize(response, maxResponseBytes, policy.url.toString());
        }

        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
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
