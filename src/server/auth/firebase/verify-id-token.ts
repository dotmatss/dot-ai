import "server-only";

import { getServerEnv } from "@/config/env";

/**
 * Verification of Firebase Authentication ID tokens.
 *
 * This is the only place in the application that decides whether a caller is
 * who Firebase says they are. Everything downstream - the session exchange, the
 * Bearer path in the DAL, the `email_verified` mirror - consumes the claims
 * returned here and never re-derives them from anything a client sent.
 *
 * ── Why not firebase-admin ──────────────────────────────────────────────────
 *
 * `firebase-admin` is a Node SDK, and this application deploys to Cloudflare
 * Workers (`docs/deployment.md`): `vinext build`, workerd, Hyperdrive. Its
 * token verification pulls in `jsonwebtoken`, `node:http2` and a credential
 * loader that expects a filesystem and a long-lived process, none of which
 * workerd provides. Adding it would either break the deployment or force a
 * second runtime just to check a signature.
 *
 * Firebase documents this exact situation: where the Admin SDK cannot run,
 * verify the ID token as an ordinary RS256 JWT against Google's published
 * public keys, applying the documented claim rules. That is what this does,
 * with WebCrypto - which is a platform global on both Node 22 and workerd - so
 * one implementation serves `next dev`, `vitest` and production unchanged, and
 * the dependency list does not grow at all.
 *
 * `firebase-admin` is still the right tool for privileged, out-of-band work -
 * importing existing password hashes, disabling an account - and
 * `scripts/migrate-users-to-firebase.mjs` uses it there, on Node, where it
 * belongs. It is a devDependency for that reason and must never be imported
 * from `src/`.
 *
 * ── What is checked ─────────────────────────────────────────────────────────
 *
 * Every rule Firebase states for a verified ID token, and no fewer:
 *
 *   alg        must be RS256 (a token presenting `none` or HS256 is refused
 *              before any key is fetched, so a forged header cannot steer the
 *              verifier onto a symmetric algorithm keyed with a public value)
 *   kid        must name a key Google is currently publishing
 *   signature  must verify against that key
 *   aud        must equal our Firebase project id
 *   iss        must be https://securetoken.google.com/<project id>
 *   exp        must be in the future
 *   iat        must not be in the future
 *   auth_time  must not be in the future
 *   sub        must be a non-empty string, at most 128 characters
 *
 * `aud` and `iss` are the checks that make this project-specific. Without them
 * a perfectly valid token minted by ANY other Firebase project - one the
 * attacker owns and can create accounts in at will - would verify here, and the
 * `sub` it carries would be matched against our `user_identities` rows. They
 * are not optional hardening; they are what stops the verifier being a free
 * pass for the entire Firebase install base.
 *
 * ── What is deliberately not checked ────────────────────────────────────────
 *
 * Revocation. Firebase can revoke refresh tokens, but an already-issued ID
 * token stays valid for its hour regardless, and checking revocation on every
 * request means an Admin SDK call per request. This application does not need
 * it: the ID token buys an application session exactly once, and from then on
 * authorization runs against `sessions` and `users.disabled_at`, both of which
 * revoke in one statement and take effect on the next request. Disabling an
 * account here is therefore strictly faster than Firebase revocation would be.
 */

/**
 * Google's public keys for Firebase ID tokens, in JWK form.
 *
 * The JWK endpoint rather than the better-known x509 one: `crypto.subtle`
 * imports a JWK directly, while the x509 response would first have to be
 * parsed out of a PEM certificate by hand - ASN.1 parsing written here, in the
 * one module where a mistake is a signature-verification bypass. Same keys,
 * same rotation, published by Google for this purpose.
 */
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

/** Tolerance for clock drift between our runtime and Google's, in seconds. */
const CLOCK_SKEW_SECONDS = 60;

/** Used only when Google's response carries no usable `Cache-Control`. */
const FALLBACK_CACHE_TTL_MS = 60 * 60 * 1000;

/** Bounds the work a junk value can cause before any parsing is attempted. */
const MAX_TOKEN_LENGTH = 8192;

export interface FirebaseIdTokenClaims {
  /** The Firebase UID. Matched against `user_identities.provider_uid`. */
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  /** e.g. `"password"`, `"google.com"`. From `firebase.sign_in_provider`. */
  signInProvider: string | null;
  /** Seconds since the epoch, as Firebase states them. */
  issuedAt: number;
  expiresAt: number;
  authTime: number | null;
}

/**
 * A token that did not verify.
 *
 * One class with a `reason`, not a class per rule: callers must not branch on
 * why a token failed, because telling a caller which check failed is how a
 * verifier becomes an oracle. `reason` exists for server logs. The message is
 * generic by construction and the token itself is never included in either.
 */
export class FirebaseTokenError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super("The sign-in token is not valid. Sign in again.");
    this.name = "FirebaseTokenError";
    this.reason = reason;
  }
}

/** Raised when the deployment has no Firebase project configured at all. */
export class FirebaseNotConfiguredError extends Error {
  constructor() {
    super("Firebase authentication is not configured. Set FIREBASE_PROJECT_ID.");
    this.name = "FirebaseNotConfiguredError";
  }
}

export function isFirebaseConfigured(): boolean {
  return Boolean(getServerEnv().FIREBASE_PROJECT_ID);
}

function requireProjectId(): string {
  const projectId = getServerEnv().FIREBASE_PROJECT_ID;
  if (!projectId) throw new FirebaseNotConfiguredError();
  return projectId;
}

// ── Key cache ───────────────────────────────────────────────────────────────

interface JwkSet {
  keys: Array<Record<string, unknown> & { kid?: string; alg?: string; kty?: string }>;
}

interface CachedKeys {
  keys: Map<string, CryptoKey>;
  expiresAt: number;
}

/**
 * Cached per isolate, not per process.
 *
 * On Workers each isolate warms its own copy, which is the correct granularity
 * - there is no shared process memory to put it in - and costs one extra fetch
 * per cold isolate rather than one per request. `inFlight` collapses the
 * concurrent misses that a cold start produces into a single fetch.
 */
let cached: CachedKeys | null = null;
let inFlight: Promise<CachedKeys> | null = null;

/** Exposed for tests, which must not inherit a previous case's keys. */
export function resetFirebaseKeyCacheForTests(): void {
  cached = null;
  inFlight = null;
}

function parseMaxAge(cacheControl: string | null): number | null {
  if (!cacheControl) return null;
  const match = /max-age\s*=\s*(\d+)/i.exec(cacheControl);
  if (!match?.[1]) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

async function fetchKeys(): Promise<CachedKeys> {
  let response: Response;
  try {
    response = await fetch(JWKS_URL, { headers: { accept: "application/json" } });
  } catch (error) {
    // Distinguished from a bad token on purpose: this is our dependency
    // failing, not the caller's credential, and the caller should be told to
    // retry rather than to sign in again.
    throw new Error(`Could not reach Google's public key endpoint: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (!response.ok) {
    throw new Error(`Google's public key endpoint returned ${response.status}`);
  }

  const body = (await response.json()) as JwkSet;
  if (!body || !Array.isArray(body.keys)) {
    throw new Error("Google's public key endpoint returned an unexpected body");
  }

  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys) {
    // Only RSA signing keys are usable here. Anything else Google publishes
    // alongside them is skipped rather than imported and later mismatched.
    if (!jwk.kid || jwk.kty !== "RSA" || (jwk.alg && jwk.alg !== "RS256")) continue;
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        { ...jwk, alg: "RS256", ext: true } as JsonWebKey,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      keys.set(jwk.kid, key);
    } catch {
      // A key we cannot import is a key we cannot verify against. Skipping it
      // fails tokens signed with it closed, rather than failing every token.
      continue;
    }
  }
  if (keys.size === 0) throw new Error("Google's public key endpoint published no usable keys");

  return { keys, expiresAt: Date.now() + (parseMaxAge(response.headers.get("cache-control")) ?? FALLBACK_CACHE_TTL_MS) };
}

async function getKeys(forceRefresh = false): Promise<CachedKeys> {
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached;
  if (!forceRefresh && inFlight) return inFlight;

  const pending = fetchKeys()
    .then((keys) => {
      cached = keys;
      return keys;
    })
    .finally(() => {
      if (inFlight === pending) inFlight = null;
    });
  inFlight = pending;
  return pending;
}

// ── Encoding helpers ────────────────────────────────────────────────────────

/**
 * `atob` and `TextDecoder` rather than `Buffer`: both are platform globals on
 * Node 22 and workerd, so this module needs no runtime branch at all.
 */
// `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`: the default type
// parameter is `ArrayBufferLike`, which includes `SharedArrayBuffer` and is
// therefore not assignable to WebCrypto's `BufferSource`.
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  const text = new TextDecoder().decode(base64UrlToBytes(segment));
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FirebaseTokenError("segment is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function readString(claims: Record<string, unknown>, key: string): string | null {
  const value = claims[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(claims: Record<string, unknown>, key: string): number | null {
  const value = claims[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ── Verification ────────────────────────────────────────────────────────────

/**
 * Verifies a Firebase ID token and returns its claims.
 *
 * Throws `FirebaseTokenError` for anything wrong with the token,
 * `FirebaseNotConfiguredError` when no project is configured, and an ordinary
 * `Error` when Google's key endpoint could not be reached - three cases the
 * caller maps to 401, 500 and 503 respectively.
 */
export async function verifyFirebaseIdToken(token: string): Promise<FirebaseIdTokenClaims> {
  const projectId = requireProjectId();

  if (typeof token !== "string" || token.length === 0) throw new FirebaseTokenError("empty token");
  if (token.length > MAX_TOKEN_LENGTH) throw new FirebaseTokenError("token exceeds maximum length");

  const parts = token.split(".");
  if (parts.length !== 3) throw new FirebaseTokenError("token is not a three-part JWT");
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJsonSegment(headerSegment);
    payload = decodeJsonSegment(payloadSegment);
  } catch {
    throw new FirebaseTokenError("token segments are not valid base64url JSON");
  }

  // Algorithm before key lookup. A token asking for `none`, or for an HMAC
  // algorithm that would treat a public key as a shared secret, is refused
  // here and never reaches `crypto.subtle`.
  if (header.alg !== "RS256") throw new FirebaseTokenError("unsupported algorithm");
  const kid = readString(header, "kid");
  if (!kid) throw new FirebaseTokenError("missing key id");

  let keys = await getKeys();
  let key = keys.keys.get(kid);
  if (!key) {
    // An unknown `kid` is the normal appearance of key rotation, so refresh
    // once before rejecting. `forceRefresh` bypasses the cached set; a token
    // citing a key Google does not publish still fails, one request later.
    keys = await getKeys(true);
    key = keys.keys.get(kid);
  }
  if (!key) throw new FirebaseTokenError("token signed with an unknown key id");

  const signature = base64UrlToBytes(signatureSegment);
  const signedData = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
  const signatureValid = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, signedData);
  if (!signatureValid) throw new FirebaseTokenError("signature did not verify");

  // Claims are only read once the signature holds: before that they are
  // attacker-controlled text, and validating them first would invite treating
  // an unverified `email` as meaningful.
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (readString(payload, "aud") !== projectId) throw new FirebaseTokenError("audience is not this Firebase project");
  if (readString(payload, "iss") !== `https://securetoken.google.com/${projectId}`) {
    throw new FirebaseTokenError("issuer is not this Firebase project");
  }

  const exp = readNumber(payload, "exp");
  if (exp === null) throw new FirebaseTokenError("missing exp");
  if (exp + CLOCK_SKEW_SECONDS <= nowSeconds) throw new FirebaseTokenError("token has expired");

  const iat = readNumber(payload, "iat");
  if (iat === null) throw new FirebaseTokenError("missing iat");
  if (iat - CLOCK_SKEW_SECONDS > nowSeconds) throw new FirebaseTokenError("token was issued in the future");

  const authTime = readNumber(payload, "auth_time");
  if (authTime !== null && authTime - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new FirebaseTokenError("auth_time is in the future");
  }

  const uid = readString(payload, "sub");
  if (!uid) throw new FirebaseTokenError("missing sub");
  if (uid.length > 128) throw new FirebaseTokenError("sub exceeds 128 characters");

  const firebaseClaim = payload.firebase;
  const signInProvider =
    firebaseClaim && typeof firebaseClaim === "object" && !Array.isArray(firebaseClaim)
      ? readString(firebaseClaim as Record<string, unknown>, "sign_in_provider")
      : null;

  return {
    uid,
    email: readString(payload, "email"),
    // Strictly `true`. A missing claim, or any other truthy value, is not
    // proof of verification and must not be read as one.
    emailVerified: payload.email_verified === true,
    name: readString(payload, "name"),
    picture: readString(payload, "picture"),
    signInProvider,
    issuedAt: iat,
    expiresAt: exp,
    authTime,
  };
}

/**
 * Extracts a Firebase ID token from an `Authorization: Bearer` header.
 *
 * Returns null for anything that is not a three-part JWT, so the developer API
 * keys that share this header (`api-key-auth.ts`, prefixed opaque strings)
 * are left for their own authenticator rather than being fed to this one.
 */
export function firebaseIdTokenFrom(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const [scheme, ...rest] = authorizationHeader.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;
  const token = rest.join("");
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : null;
}
