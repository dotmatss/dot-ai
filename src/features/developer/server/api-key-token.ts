import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { API_KEY_DISPLAY_CHARS, API_KEY_PREFIX, API_KEY_RANDOM_BYTES, API_KEY_RANDOM_LENGTH } from "@/features/developer/constants";

/**
 * API key format and hashing.
 *
 * A key is `dot_live_` + 32 base64url characters (24 random bytes, ~192 bits).
 * Only the SHA-256 hash and a short display prefix are ever persisted, so a
 * database disclosure does not hand an attacker working credentials. The prefix
 * is what the UI shows afterwards; the full value is displayed exactly once, at
 * creation.
 *
 * SHA-256 without a work factor is deliberate and safe *here*: unlike a
 * password, the secret is 192 bits of uniform randomness we generate, so there
 * is nothing to brute force. It also has to be cheap, because the public API
 * hashes the presented key on every request.
 */

export interface GeneratedApiKey {
  /** Full key. Returned to the caller once and never stored. */
  secret: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const random = randomBytes(API_KEY_RANDOM_BYTES).toString("base64url");
  const secret = `${API_KEY_PREFIX}${random}`;
  return { secret, prefix: apiKeyPrefixOf(secret), hash: hashApiKey(secret) };
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** The display-safe leading characters: the scheme plus a short discriminator. */
export function apiKeyPrefixOf(secret: string): string {
  return secret.slice(0, API_KEY_PREFIX.length + API_KEY_DISPLAY_CHARS);
}

/** Cheap shape check so a malformed header never reaches the database. */
export function looksLikeApiKey(value: string): boolean {
  if (!value.startsWith(API_KEY_PREFIX)) return false;
  const random = value.slice(API_KEY_PREFIX.length);
  return random.length === API_KEY_RANDOM_LENGTH && /^[A-Za-z0-9_-]+$/.test(random);
}

/**
 * Extracts the key from an `Authorization: Bearer …` header. Returns null for
 * anything else, including Basic auth and an empty bearer value.
 */
export function bearerTokenFrom(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = /^Bearer[ ]+(\S+)$/i.exec(headerValue.trim());
  return match?.[1] ?? null;
}
