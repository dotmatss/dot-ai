import "server-only";

import { extractHtmlTitle, htmlToText, looksLikeText } from "@/features/knowledge/html-text";
import { checkIngestUrl } from "@/features/knowledge/url-safety";
import { ApiError } from "@/lib/api/api-error";
import { createGuardedFetch, EgressBlockedError } from "@/server/http/egress-guard";

/**
 * Server-side fetch of a user-supplied URL.
 *
 * Every control here exists because the request originates inside our network.
 * The network half of them - the scheme and host policy, the DNS-level address
 * checks, pinning the socket to the validated address, the redirect budget with
 * a re-check on each hop, the wall-clock timeout and the response size cap -
 * belongs to the shared egress guard, so there is one implementation of it
 * rather than a copy per caller. `checkIngestUrl` is handed to the guard so its
 * refusals stay worded for someone importing a page.
 *
 * What remains here is what is specific to importing a document: the
 * content-type allow-list, decoding and text extraction. A failure is always an
 * ApiError with a message the user can act on.
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

const fetchGuarded = createGuardedFetch({
  timeoutMs: FETCH_TIMEOUT_MS,
  maxRedirects: MAX_REDIRECTS,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  // `checkIngestUrl` permits http, and the address policy still applies to it.
  requireHttps: false,
  checkUrl: checkIngestUrl,
});

export interface FetchedDocument {
  text: string;
  title: string | null;
  finalUrl: string;
  contentType: string;
  byteLength: number;
}

function normalizeContentType(header: string | null): string {
  return (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** Releases a response we are about to reject, so the socket is not held open. */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Re-phrases a refusal from the shared guard for someone importing a page. */
function ingestError(error: unknown, host: string): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof EgressBlockedError) {
    switch (error.kind) {
      case "size":
        return ApiError.badRequest(`That page is larger than ${MAX_RESPONSE_BYTES / (1024 * 1024)} MB.`);
      case "redirect-limit":
        return ApiError.badRequest("That URL redirects too many times.");
      case "redirect-location":
        return ApiError.badRequest("The page returned a redirect without a destination.");
      default:
        // An open redirect is the usual way to smuggle a request to a private
        // address past the first check, so say which half failed.
        return ApiError.badRequest(
          error.hop > 0 ? `That URL redirects to a location that cannot be imported. ${error.message}` : error.message,
        );
    }
  }
  if (error instanceof Error && error.name === "AbortError") {
    return ApiError.badRequest(`${host} did not respond within ${FETCH_TIMEOUT_MS / 1000} seconds.`);
  }
  return ApiError.badRequest(`Could not reach ${host}: ${error instanceof Error ? error.message : "request failed"}.`);
}

export async function fetchUrlDocument(rawUrl: string): Promise<FetchedDocument> {
  const initial = checkIngestUrl(rawUrl);
  if (!initial.ok) throw ApiError.badRequest(initial.reason);

  let response: Response;
  try {
    response = await fetchGuarded(initial.url, {
      headers: {
        Accept: "text/html, text/plain, text/markdown, application/xhtml+xml;q=0.9, */*;q=0.1",
        "User-Agent": "dot-knowledge-importer/1.0",
      },
    });
  } catch (error) {
    throw ingestError(error, initial.url.hostname);
  }

  const finalUrl = response.url || initial.url.href;
  const host = hostOf(finalUrl) ?? initial.url.hostname;

  if (!response.ok) {
    await discard(response);
    throw ApiError.badRequest(`${host} returned HTTP ${response.status}.`);
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

  // The guard caps the body as it streams, so reading it whole is bounded.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw ingestError(error, host);
  }
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
    finalUrl,
    contentType: contentType || "text/plain",
    byteLength: bytes.byteLength,
  };
}
