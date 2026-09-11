import "server-only";

import { lookup } from "node:dns/promises";

import { extractHtmlTitle, htmlToText, looksLikeText } from "@/features/knowledge/html-text";
import { checkIngestUrl, isBlockedIpAddress } from "@/features/knowledge/url-safety";
import { ApiError } from "@/lib/api/api-error";

/**
 * Server-side fetch of a user-supplied URL.
 *
 * Every control here exists because the request originates inside our network:
 * scheme and host allow-lists, DNS-level address checks, a redirect budget with
 * a re-check on each hop, a wall-clock timeout, a response size cap and a
 * content-type allow-list. A failure is always an ApiError with a message the
 * user can act on.
 */

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 2;

const ALLOWED_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "text/csv",
];

export interface FetchedDocument {
  text: string;
  title: string | null;
  finalUrl: string;
  contentType: string;
  byteLength: number;
}

/**
 * Rejects hostnames that resolve to a non-public address. Literal addresses are
 * already rejected by `checkIngestUrl`; this closes the gap where a public name
 * points at private space.
 */
async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "");
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw ApiError.badRequest(`Could not resolve ${hostname}. Check the address and try again.`);
  }
  if (addresses.length === 0) {
    throw ApiError.badRequest(`Could not resolve ${hostname}. Check the address and try again.`);
  }
  if (addresses.some((entry) => isBlockedIpAddress(entry.address))) {
    throw ApiError.badRequest(`${hostname} resolves to a private address, which cannot be imported.`);
  }
}

function normalizeContentType(header: string | null): string {
  return (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** Releases a response we are about to reject, so the socket is not held open. */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** Reads the body with a hard byte cap so a huge or endless response cannot exhaust memory. */
async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw ApiError.badRequest(`That page is larger than ${MAX_RESPONSE_BYTES / (1024 * 1024)} MB.`);
  }
  const body = response.body;
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        throw ApiError.badRequest(`That page is larger than ${MAX_RESPONSE_BYTES / (1024 * 1024)} MB.`);
      }
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return merged;
}

export async function fetchUrlDocument(rawUrl: string): Promise<FetchedDocument> {
  const initial = checkIngestUrl(rawUrl);
  if (!initial.ok) throw ApiError.badRequest(initial.reason);

  const controller = new AbortController();
  // One budget for the whole exchange, redirects included.
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let target = initial.url;
    let response: Response | undefined;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(target.hostname);
      let hopResponse: Response;
      try {
        hopResponse = await fetch(target, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept: "text/html, text/plain, text/markdown, application/xhtml+xml;q=0.9, */*;q=0.1",
            "User-Agent": "dot-knowledge-importer/1.0",
          },
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw ApiError.badRequest(`${target.hostname} did not respond within ${FETCH_TIMEOUT_MS / 1000} seconds.`);
        }
        throw ApiError.badRequest(`Could not reach ${target.hostname}: ${error instanceof Error ? error.message : "request failed"}.`);
      }

      const isRedirect = hopResponse.status >= 300 && hopResponse.status < 400;
      if (!isRedirect) {
        response = hopResponse;
        break;
      }

      const location = hopResponse.headers.get("location");
      await discard(hopResponse);
      if (!location) throw ApiError.badRequest("The page returned a redirect without a destination.");
      if (hop === MAX_REDIRECTS) throw ApiError.badRequest("That URL redirects too many times.");

      // Re-validate the destination: an open redirect is the usual way to
      // smuggle a request to a private address past the first check.
      const next = checkIngestUrl(new URL(location, target).href);
      if (!next.ok) throw ApiError.badRequest(`That URL redirects to a location that cannot be imported. ${next.reason}`);
      target = next.url;
    }

    if (!response) throw ApiError.badRequest("That URL redirects too many times.");

    if (!response.ok) {
      await discard(response);
      throw ApiError.badRequest(`${target.hostname} returned HTTP ${response.status}.`);
    }

    // An unknown or missing type is refused rather than sniffed: a PDF or an
    // archive would otherwise be indexed as unreadable bytes.
    const contentType = normalizeContentType(response.headers.get("content-type"));
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      await discard(response);
      throw ApiError.badRequest(
        `That URL serves “${contentType || "no content type"}”. Only HTML and plain text pages can be imported.`,
      );
    }

    const bytes = await readCapped(response);
    if (bytes.byteLength === 0) throw ApiError.badRequest("That page returned no content.");

    // Charset detection is out of scope: the modern web is UTF-8 and a
    // mis-decoded page is caught by the text check below.
    const decoded = new TextDecoder("utf-8").decode(bytes);
    if (!looksLikeText(decoded)) {
      throw ApiError.badRequest("That URL does not serve readable UTF-8 text.");
    }

    const isHtml = contentType === "text/html" || contentType === "application/xhtml+xml" || /<html[\s>]/i.test(decoded);
    const text = isHtml ? htmlToText(decoded) : decoded;
    if (!text.trim()) throw ApiError.badRequest("No readable text could be extracted from that page.");

    return {
      text,
      title: isHtml ? extractHtmlTitle(decoded) : null,
      finalUrl: target.href,
      contentType: contentType || "text/plain",
      byteLength: bytes.byteLength,
    };
  } finally {
    clearTimeout(timer);
  }
}
