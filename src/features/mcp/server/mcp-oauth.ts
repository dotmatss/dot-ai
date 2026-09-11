import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/config/env";
import { openSecret, sealSecret, SecretDecryptionError } from "@/features/integrations/server/secret-box";
import { MCP_LIMITS } from "@/features/mcp/constants";
import { discoverOauth } from "@/features/mcp/server/mcp-oauth-metadata";
import * as repository from "@/features/mcp/server/mcp-repository";
import { siteConfig } from "@/config/site";
import { ApiError } from "@/lib/api/api-error";
import { createGuardedFetch, EgressBlockedError } from "@/server/http/egress-guard";

/**
 * OAuth 2.1 for MCP servers.
 *
 * ## What we are
 *
 * A public client with no secret. Revision 2026-07-28 deprecates Dynamic
 * Client Registration in favour of a Client ID Metadata Document, so our
 * `client_id` is the URL of a document we publish and there is nothing to
 * register. Being a public client is why PKCE is mandatory here rather than
 * advisable: it is the only thing binding the code to whoever requested it.
 *
 * ## The four controls that make this safe
 *
 *  1. **PKCE (S256).** The verifier is sealed in the state row and can only be
 *     redeemed once, because redeeming deletes the row.
 *  2. **`state`.** A single-use random value. It is also the only thing the
 *     callback carries that tells us which workspace and server the response
 *     belongs to — we deliberately do not take either from the query string.
 *  3. **`resource` (RFC 8707).** Every request names the MCP server the token
 *     is for, so a token minted for one customer's server cannot be replayed
 *     at another.
 *  4. **`iss` (RFC 9207).** When the authorization server returns an issuer, it
 *     must be the one we started with. Together with the issuer check in
 *     discovery this is what closes the authorization-server mix-up attack.
 *
 * Every outbound request — discovery, the token exchange, the refresh — goes
 * through the shared egress guard. The token endpoint is a URL from a document
 * a customer's server controls, so it is exactly as untrusted as the MCP
 * endpoint itself.
 */

/** Refreshed this long before expiry, so a call does not race the clock. */
const REFRESH_MARGIN_MS = 60_000;

/** An authorization a person walked away from is not a pending task. */
const STATE_TTL_MS = 10 * 60_000;

const tokenFetch = createGuardedFetch({
  timeoutMs: MCP_LIMITS.requestTimeoutMs,
  maxResponseBytes: 256_000,
  requireHttps: true,
});

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

/** Binding context for a sealed OAuth secret. Workspace first, as everywhere. */
function tokenContext(workspaceId: string, serverId: string): string {
  return `mcp-oauth:${workspaceId}:${serverId}`;
}

function verifierContext(workspaceId: string, serverId: string): string {
  return `mcp-oauth-pkce:${workspaceId}:${serverId}`;
}

/** The URL of our Client ID Metadata Document, which *is* the client id. */
export function clientId(): string {
  return new URL("/api/mcp/client-metadata", getServerEnv().APP_URL).toString();
}

export function redirectUri(): string {
  return new URL("/api/mcp/oauth/callback", getServerEnv().APP_URL).toString();
}

/**
 * The document served at `clientId()`.
 *
 * Public and unauthenticated by necessity: an authorization server fetches it
 * to learn who is asking. It contains no secret, and it must not — it is a
 * description of a public client.
 */
export function clientMetadataDocument(): Record<string, unknown> {
  return {
    client_id: clientId(),
    client_name: `${siteConfig.name} MCP client`,
    client_uri: getServerEnv().APP_URL,
    redirect_uris: [redirectUri()],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    code_challenge_methods_supported: ["S256"],
  };
}

export interface BeginOauthInput {
  workspaceId: string;
  userId: string;
  serverId: string;
  endpointUrl: string;
  /** From a `WWW-Authenticate` challenge, when one prompted this. */
  resourceMetadataUrl?: string | null;
  /** A scope the server said it needed, for a step-up authorization. */
  requestedScope?: string | null;
}

export type BeginOauthResult = { ok: true; authorizationUrl: string } | { ok: false; reason: string };

/**
 * Starts an authorization.
 *
 * Discovery happens here rather than at the callback, and everything it
 * resolved is written into the state row. A server that rewrites its metadata
 * while the person is away at the authorization server therefore cannot move
 * our token exchange somewhere else.
 */
export async function beginMcpOauth(input: BeginOauthInput): Promise<BeginOauthResult> {
  const discovery = await discoverOauth(input.endpointUrl, input.resourceMetadataUrl ?? null);
  if (!discovery.ok) return { ok: false, reason: discovery.reason };

  const { metadata, resource } = discovery;

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(32));

  // Any earlier attempt for this server is abandoned. Leaving them would mean
  // several live verifiers for one connection, each usable once.
  await repository.deleteOauthStates(input.workspaceId, input.serverId);

  const scope = input.requestedScope?.trim() || (metadata.scopesSupported.length > 0 ? metadata.scopesSupported.join(" ") : null);

  await repository.insertOauthState({
    workspaceId: input.workspaceId,
    mcpServerId: input.serverId,
    state,
    verifier: sealSecret(verifier, verifierContext(input.workspaceId, input.serverId)),
    issuer: metadata.issuer,
    authorizationEndpoint: metadata.authorizationEndpoint,
    tokenEndpoint: metadata.tokenEndpoint,
    clientId: clientId(),
    scope,
    resource,
    redirectUri: redirectUri(),
    createdBy: input.userId,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });

  const authorize = new URL(metadata.authorizationEndpoint);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId());
  authorize.searchParams.set("redirect_uri", redirectUri());
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("state", state);
  // RFC 8707. Sent on the authorization request as well as the token request,
  // so the authorization server can scope consent to this resource.
  authorize.searchParams.set("resource", resource);
  if (scope) authorize.searchParams.set("scope", scope);

  return { ok: true, authorizationUrl: authorize.toString() };
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
}

/**
 * Posts to a token endpoint.
 *
 * Form-encoded with no client authentication, which is correct for a public
 * client using CIMD: there is no secret to present.
 */
async function postToken(
  tokenEndpoint: string,
  body: Record<string, string>,
): Promise<{ ok: true; token: TokenResponse } | { ok: false; reason: string }> {
  let response: Response;
  try {
    response = await tokenFetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body).toString(),
    });
  } catch (error) {
    if (error instanceof EgressBlockedError) return { ok: false, reason: error.message };
    return { ok: false, reason: "The authorization server could not be reached." };
  }

  let parsed: TokenResponse;
  try {
    parsed = (await response.json()) as TokenResponse;
  } catch {
    return { ok: false, reason: "The authorization server did not return JSON." };
  }

  if (!response.ok || typeof parsed.access_token !== "string") {
    // The error code is useful; the description is server-controlled text and
    // is not echoed into our UI verbatim.
    const code = typeof parsed.error === "string" ? parsed.error : `HTTP ${response.status}`;
    return { ok: false, reason: `The authorization server refused the request (${code}).` };
  }

  return { ok: true, token: parsed };
}

function expiryFrom(expiresIn: unknown): Date | null {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return new Date(Date.now() + expiresIn * 1_000);
}

export interface CompleteOauthResult {
  workspaceId: string;
  serverId: string;
}

/**
 * Finishes an authorization.
 *
 * Note what is *not* trusted here: neither the workspace nor the server comes
 * from the request. Both are read from the state row, which is the only thing
 * that ties this callback to something we started.
 */
export async function completeMcpOauth(params: {
  state: string;
  code: string;
  /** RFC 9207 issuer identifier, when the authorization server sends one. */
  iss?: string | null;
}): Promise<CompleteOauthResult> {
  // Single use: redeeming deletes the row, so a replayed callback finds nothing.
  const stored = await repository.redeemOauthState(params.state);
  if (!stored) throw ApiError.badRequest("That authorization has already been used or has expired. Start again.");

  if (stored.expiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest("That authorization took too long. Start again.");
  }

  // RFC 9207. Compared in constant time because it is a security decision on
  // attacker-supplied input, and compared only when present because not every
  // authorization server sends it.
  if (params.iss) {
    const expected = Buffer.from(stored.issuer);
    const actual = Buffer.from(params.iss);
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!matches) throw ApiError.badRequest("The authorization response came from a different issuer than the one we started with.");
  }

  let verifier: string;
  try {
    verifier = openSecret(stored.verifier, verifierContext(stored.workspaceId, stored.mcpServerId));
  } catch (error) {
    if (error instanceof SecretDecryptionError) throw ApiError.badRequest("That authorization could not be verified. Start again.");
    throw error;
  }

  const exchanged = await postToken(stored.tokenEndpoint, {
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: stored.redirectUri,
    client_id: stored.clientId,
    code_verifier: verifier,
    resource: stored.resource,
  });
  if (!exchanged.ok) throw ApiError.badRequest(exchanged.reason);

  const token = exchanged.token;
  const access = String(token.access_token);
  const refresh = typeof token.refresh_token === "string" ? token.refresh_token : null;

  await repository.upsertOauthToken({
    workspaceId: stored.workspaceId,
    mcpServerId: stored.mcpServerId,
    issuer: stored.issuer,
    tokenEndpoint: stored.tokenEndpoint,
    clientId: stored.clientId,
    // What was granted, which may be narrower than what was asked for.
    resource: stored.resource,
    scope: typeof token.scope === "string" ? token.scope : stored.scope,
    access: sealSecret(access, tokenContext(stored.workspaceId, stored.mcpServerId)),
    accessExpiresAt: expiryFrom(token.expires_in),
    refresh: refresh ? sealSecret(refresh, tokenContext(stored.workspaceId, stored.mcpServerId)) : null,
    authorizedBy: null,
  });

  return { workspaceId: stored.workspaceId, serverId: stored.mcpServerId };
}

/**
 * A usable access token for a server, refreshing it if it is about to expire.
 *
 * Returns null rather than throwing when there is nothing usable: the caller
 * then makes the request without a credential and the server's own 401 is what
 * tells the customer to re-authorize. Guessing on their behalf would hide the
 * real reason.
 */
export async function accessTokenFor(workspaceId: string, serverId: string): Promise<string | null> {
  const record = await repository.findOauthToken(workspaceId, serverId);
  if (!record) return null;

  const expiring = record.accessExpiresAt !== null && record.accessExpiresAt.getTime() - REFRESH_MARGIN_MS <= Date.now();

  if (!expiring) {
    try {
      return openSecret(record.access, tokenContext(workspaceId, serverId));
    } catch (error) {
      if (error instanceof SecretDecryptionError) return null;
      throw error;
    }
  }

  if (!record.refresh) return null;

  let refreshToken: string;
  try {
    refreshToken = openSecret(record.refresh, tokenContext(workspaceId, serverId));
  } catch (error) {
    if (error instanceof SecretDecryptionError) return null;
    throw error;
  }

  const refreshed = await postToken(record.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: record.clientId,
    // The resource the grant was made for, read back rather than re-derived:
    // a refresh that widened or moved the audience would be a different grant.
    resource: record.resource,
  });

  if (!refreshed.ok) {
    // A refresh that fails means re-authorizing, and the stored token is no
    // longer useful. It is removed rather than left to fail every later call.
    await repository.deleteOauthToken(workspaceId, serverId);
    return null;
  }

  const token = refreshed.token;
  const access = String(token.access_token);
  const rotated = typeof token.refresh_token === "string" ? token.refresh_token : refreshToken;

  await repository.upsertOauthToken({
    workspaceId,
    mcpServerId: serverId,
    issuer: record.issuer,
    tokenEndpoint: record.tokenEndpoint,
    clientId: record.clientId,
    resource: record.resource,
    scope: typeof token.scope === "string" ? token.scope : record.scope,
    access: sealSecret(access, tokenContext(workspaceId, serverId)),
    accessExpiresAt: expiryFrom(token.expires_in),
    refresh: sealSecret(rotated, tokenContext(workspaceId, serverId)),
    authorizedBy: null,
  });

  return access;
}

/** True when a server is configured for OAuth but holds no usable token. */
export async function needsAuthorization(workspaceId: string, serverId: string): Promise<boolean> {
  const record = await repository.findOauthToken(workspaceId, serverId);
  return record === null;
}

/** Forgets a server's tokens, so the next call is unauthenticated and says so. */
export async function revokeMcpOauth(workspaceId: string, serverId: string): Promise<void> {
  await repository.deleteOauthToken(workspaceId, serverId);
  await repository.deleteOauthStates(workspaceId, serverId);
}
