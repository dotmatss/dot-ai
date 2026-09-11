import "server-only";

import { MCP_LIMITS } from "@/features/mcp/constants";
import { createGuardedFetch, EgressBlockedError } from "@/server/http/egress-guard";

/**
 * OAuth discovery for an MCP server.
 *
 * Three documents, in order, each one telling us where to look next:
 *
 *  1. **Protected Resource Metadata** (RFC 9728) at the MCP server, which names
 *     the authorization servers it trusts.
 *  2. **Authorization Server Metadata** (RFC 8414) at the authorization server,
 *     which gives the endpoints.
 *  3. Our own **Client ID Metadata Document**, which we publish; its URL is the
 *     `client_id`. Revision 2026-07-28 deprecates Dynamic Client Registration
 *     in favour of this, so there is nothing to register and no secret.
 *
 * ## Why this is the dangerous part
 *
 * Every URL here comes from a document written by whoever controls the server a
 * customer typed in, and each one makes us issue another request. That is a
 * server-side request forgery primitive by construction, and the MCP
 * specification says so explicitly. So every fetch goes through the shared
 * egress guard — https only, public addresses only, socket pinned to the
 * validated address, redirects re-checked per hop, bounded body and clock —
 * and every document is validated before anything in it is used.
 *
 * ## The checks that stop a mix-up attack
 *
 *  - An authorization server's metadata must declare its own `issuer`, and it
 *    must equal the issuer we went looking for. Without that, a compromised
 *    resource can point us at a metadata document that names someone else's
 *    endpoints and collect codes meant for them.
 *  - Every endpoint must be https and must belong to the issuer's origin.
 *  - PKCE with S256 must be advertised. A server that cannot do PKCE cannot be
 *    used safely for a public client, and we are a public client.
 */

/** Fetches metadata under the same controls as every other outbound request. */
const fetchMetadata = createGuardedFetch({
  timeoutMs: MCP_LIMITS.requestTimeoutMs,
  // Metadata documents are small. A large one is a reason to stop, not to read.
  maxResponseBytes: 256_000,
  requireHttps: true,
});

export interface AuthorizationServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Scopes the server advertises, when it says. */
  scopesSupported: string[];
}

export type OauthDiscoveryResult =
  | { ok: true; metadata: AuthorizationServerMetadata; resource: string }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(url: string): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; reason: string }> {
  let response: Response;
  try {
    response = await fetchMetadata(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    // The guard's own refusals are worth surfacing: "that host is not publicly
    // reachable" is actionable, where "discovery failed" is not.
    if (error instanceof EgressBlockedError) return { ok: false, reason: error.message };
    return { ok: false, reason: "The authorization metadata could not be fetched." };
  }

  if (!response.ok) return { ok: false, reason: `The metadata endpoint answered with HTTP ${response.status}.` };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "The metadata endpoint did not return JSON." };
  }
  if (!isRecord(body)) return { ok: false, reason: "The metadata document was not a JSON object." };
  return { ok: true, body };
}

/**
 * The canonical resource identifier for an MCP server (RFC 8707).
 *
 * The path is kept and the query and fragment are dropped, because the token
 * we ask for is bound to this string: a token issued for
 * `https://example.com/mcp` must not be usable at `https://example.com/admin`.
 */
export function canonicalResource(endpointUrl: string): string {
  const url = new URL(endpointUrl);
  url.search = "";
  url.hash = "";
  // A trailing slash on a path is significant to string comparison but not to
  // the server, so it is normalised away.
  if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

/**
 * Where the protected resource metadata lives.
 *
 * RFC 9728 inserts the well-known segment *before* the resource path rather
 * than appending it, which is easy to get wrong and yields a 404 that looks
 * like "this server does not support OAuth".
 */
export function protectedResourceMetadataUrl(endpointUrl: string): string {
  const url = new URL(endpointUrl);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return new URL(`/.well-known/oauth-protected-resource${path}`, url.origin).toString();
}

/** RFC 8414 puts the well-known segment before the issuer's path, too. */
export function authorizationServerMetadataUrl(issuer: string): string {
  const url = new URL(issuer);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return new URL(`/.well-known/oauth-authorization-server${path}`, url.origin).toString();
}

function sameOrigin(candidate: string, issuer: string): boolean {
  try {
    return new URL(candidate).origin === new URL(issuer).origin;
  } catch {
    return false;
  }
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * Reads the authorization server's metadata and checks it is really theirs.
 *
 * Exported separately from `discoverOauth` so the issuer check can be tested on
 * its own: it is the single control that stops an authorization-server mix-up.
 */
export async function readAuthorizationServerMetadata(issuer: string): Promise<{ ok: true; metadata: AuthorizationServerMetadata } | { ok: false; reason: string }> {
  const expected = httpsUrl(issuer);
  if (!expected) return { ok: false, reason: "The authorization server must be an https URL." };

  const document = await readJson(authorizationServerMetadataUrl(expected));
  if (!document.ok) return document;

  const body = document.body;

  // The mix-up check. A document that does not claim the issuer we asked for
  // is not that issuer's document, whoever served it.
  const declared = typeof body.issuer === "string" ? body.issuer : "";
  if (new URL(expected).origin !== (httpsUrl(declared) ? new URL(declared).origin : "")) {
    return { ok: false, reason: "The authorization server's metadata names a different issuer." };
  }

  const authorizationEndpoint = httpsUrl(body.authorization_endpoint);
  const tokenEndpoint = httpsUrl(body.token_endpoint);
  if (!authorizationEndpoint || !tokenEndpoint) {
    return { ok: false, reason: "The authorization server did not advertise https authorization and token endpoints." };
  }
  if (!sameOrigin(authorizationEndpoint, declared) || !sameOrigin(tokenEndpoint, declared)) {
    return { ok: false, reason: "The authorization server's endpoints are on a different origin to its issuer." };
  }

  // We are a public client with no secret, so PKCE is not optional.
  const challengeMethods = stringList(body.code_challenge_methods_supported);
  if (!challengeMethods.includes("S256")) {
    return { ok: false, reason: "The authorization server does not support PKCE with S256, which this client requires." };
  }

  return {
    ok: true,
    metadata: {
      issuer: declared,
      authorizationEndpoint,
      tokenEndpoint,
      scopesSupported: stringList(body.scopes_supported),
    },
  };
}

/**
 * Full discovery for one MCP endpoint.
 *
 * `resourceMetadataUrl` is the value from a `WWW-Authenticate` header when the
 * server sent one; the specification prefers it over the well-known guess, and
 * it is checked against the server's own origin before being fetched so a 401
 * cannot redirect discovery to a third party.
 */
export async function discoverOauth(endpointUrl: string, resourceMetadataUrl?: string | null): Promise<OauthDiscoveryResult> {
  const resource = canonicalResource(endpointUrl);

  let metadataUrl = protectedResourceMetadataUrl(endpointUrl);
  if (resourceMetadataUrl) {
    const offered = httpsUrl(resourceMetadataUrl);
    if (!offered || !sameOrigin(offered, endpointUrl)) {
      return { ok: false, reason: "The server pointed its metadata at another origin, which is not allowed." };
    }
    metadataUrl = offered;
  }

  const document = await readJson(metadataUrl);
  if (!document.ok) {
    return { ok: false, reason: `${document.reason} This server may not support OAuth.` };
  }

  // The document must be about the resource we are actually talking to.
  const declaredResource = typeof document.body.resource === "string" ? document.body.resource : "";
  if (declaredResource && canonicalResource(declaredResource) !== resource) {
    return { ok: false, reason: "The server's metadata describes a different resource." };
  }

  const issuers = stringList(document.body.authorization_servers);
  const issuer = issuers.map(httpsUrl).find((value): value is string => value !== null);
  if (!issuer) {
    return { ok: false, reason: "The server did not name an https authorization server." };
  }

  const metadata = await readAuthorizationServerMetadata(issuer);
  if (!metadata.ok) return metadata;

  return { ok: true, metadata: metadata.metadata, resource };
}

/**
 * The `resource_metadata` hint from a 401.
 *
 * Parsed rather than pattern-matched loosely, because the value decides which
 * URL we fetch next. Anything unparseable yields null and discovery falls back
 * to the well-known location.
 */
export function resourceMetadataFromChallenge(header: string | null): string | null {
  if (!header) return null;
  const match = /resource_metadata\s*=\s*"([^"]+)"/i.exec(header) ?? /resource_metadata\s*=\s*([^\s,]+)/i.exec(header);
  return match?.[1] ?? null;
}
