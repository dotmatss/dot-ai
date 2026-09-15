import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import { getServerEnv } from "@/config/env";

/**
 * Authenticated encryption for integration credentials.
 *
 * AES-256-GCM with a key derived from APP_SECRET. Decisions worth stating:
 *
 * - The key is derived, never used raw: APP_SECRET is a passphrase of unknown
 *   entropy shape, so scrypt with a fixed application salt turns it into 32
 *   uniformly distributed bytes. The salt is a constant rather than per-record
 *   because it only needs to domain-separate this use of APP_SECRET from the
 *   embed-token HMAC; the per-record uniqueness that matters comes from the IV.
 * - A fresh 12-byte IV per seal. Reusing an IV under the same key is
 *   catastrophic for GCM, so it is never derived from the plaintext.
 * - `context` is bound as additional authenticated data. A ciphertext lifted
 *   from one workspace's row into another's therefore fails to open instead of
 *   silently decrypting - tenant isolation survives even a row-level mistake.
 * - Every failure (wrong key, flipped bit, swapped context, truncated tag) is
 *   the same loud throw. There is no "best effort" path that returns partial
 *   plaintext.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Domain separation constant: distinguishes this key derivation from any other use of APP_SECRET. */
const KEY_SALT = "dot.integration-secrets.v1";

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

export class SecretDecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretDecryptionError";
  }
}

let cachedKey: { secret: string; key: Buffer } | null = null;

function encryptionKey(): Buffer {
  const secret = getServerEnv().APP_SECRET;
  // Cached per APP_SECRET value: scrypt is deliberately expensive, and every
  // seal/open on a request path would otherwise pay for it.
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const key = scryptSync(secret, KEY_SALT, KEY_BYTES);
  cachedKey = { secret, key };
  return key;
}

/**
 * Encrypts `plaintext`, binding it to `context` (workspace id + provider).
 * The same context must be supplied to open it.
 */
export function sealSecret(plaintext: string, context: string): SealedSecret {
  if (!context) throw new Error("sealSecret requires a binding context");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/** Decrypts a sealed secret. Throws `SecretDecryptionError` on any tampering. */
export function openSecret(sealed: SealedSecret, context: string): string {
  if (!context) throw new Error("openSecret requires a binding context");
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.tag, "base64");
  // Length checks first: createDecipheriv throws a driver-shaped error for a
  // malformed IV, and callers should see one consistent failure type.
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretDecryptionError("Stored secret is malformed");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (error) {
    // The message never includes the ciphertext, the context or any partial
    // plaintext: a decryption failure must not become an oracle.
    throw new SecretDecryptionError("Stored secret could not be decrypted", { cause: error });
  }
}

/** Seals a map of named secrets as one envelope, so replacing one field rewrites the row. */
export function sealSecretMap(secrets: Record<string, string>, context: string): SealedSecret {
  return sealSecret(JSON.stringify(secrets), context);
}

export function openSecretMap(sealed: SealedSecret, context: string): Record<string, string> {
  const parsed: unknown = JSON.parse(openSecret(sealed, context));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SecretDecryptionError("Stored secret could not be decrypted");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** The binding context for one workspace's provider credentials. */
export function secretContext(workspaceId: string, provider: string): string {
  return `workspace:${workspaceId}:integration:${provider}`;
}

/**
 * The binding context for one outbound credential (migration 0026).
 *
 * Distinct from `secretContext` above by the `credential` segment, so an
 * envelope sealed for a catalogue provider cannot be opened as a standalone
 * credential or the reverse - the two are reached by different code paths and
 * should not be interchangeable even within one workspace.
 */
export function credentialSecretContext(workspaceId: string, credentialId: string): string {
  return `workspace:${workspaceId}:credential:${credentialId}`;
}
