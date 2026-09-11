import "server-only";

import { after } from "next/server";

import { findApiKeyCredentialByHash, touchApiKeyLastUsed } from "@/features/integrations/server/api-key-repository";
import { bearerTokenFrom, hashApiKey, looksLikeApiKey } from "@/features/integrations/server/api-key-token";
import { secretsMatch } from "@/features/integrations/server/secret-box";

/**
 * Authentication for the public, key-based API.
 *
 * The workspace is derived from the key, never from the request: a caller
 * cannot name the tenant it wants to act on. Every rejection returns `null`
 * with no detail about which check failed, so the endpoint cannot be used to
 * probe which keys exist.
 */

export interface ApiKeyIdentity {
  workspaceId: string;
  apiKeyId: string;
}

/** Throttle for `last_used_at`: a busy key would otherwise write a row per request. */
const TOUCH_INTERVAL_MS = 60_000;
const MAX_TRACKED_KEYS = 10_000;
const lastTouchedAt = new Map<string, number>();

function shouldTouch(apiKeyId: string, now: number): boolean {
  const previous = lastTouchedAt.get(apiKeyId);
  if (previous !== undefined && now - previous < TOUCH_INTERVAL_MS) return false;
  // Bounded: Map iteration is insertion-ordered, so this drops the coldest entry.
  if (lastTouchedAt.size >= MAX_TRACKED_KEYS) {
    const oldest = lastTouchedAt.keys().next();
    if (!oldest.done) lastTouchedAt.delete(oldest.value);
  }
  lastTouchedAt.set(apiKeyId, now);
  return true;
}

function scheduleTouch(apiKeyId: string): void {
  const task = async () => {
    try {
      await touchApiKeyLastUsed(apiKeyId);
    } catch (error) {
      // Best effort: last use is telemetry, never a reason to fail a request.
      console.error("[api-key] could not record last_used_at", error);
    }
  };
  try {
    // after() runs once the response - including a stream - is finished, so
    // this never delays the caller.
    after(task);
  } catch {
    // Called outside a request scope (a script, a test): fall back to a
    // detached promise rather than losing the write or throwing.
    void task();
  }
}

export async function authenticateApiKey(request: Request): Promise<ApiKeyIdentity | null> {
  const token = bearerTokenFrom(request.headers.get("authorization"));
  // Shape is checked before the database so a flood of junk headers costs nothing.
  if (!token || !looksLikeApiKey(token)) return null;

  const presentedHash = hashApiKey(token);
  const credential = await findApiKeyCredentialByHash(presentedHash);
  if (!credential) return null;

  // The lookup already matched on hash; this comparison is what the security
  // property is stated in terms of, and keeps that true if the lookup ever
  // becomes a range scan or a cache.
  if (!secretsMatch(credential.keyHash, presentedHash)) return null;
  if (credential.revokedAt !== null) return null;

  if (shouldTouch(credential.id, Date.now())) scheduleTouch(credential.id);

  return { workspaceId: credential.workspaceId, apiKeyId: credential.id };
}
