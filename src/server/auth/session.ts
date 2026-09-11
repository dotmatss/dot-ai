import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { cookies, headers } from "next/headers";

import { getServerEnv } from "@/config/env";
import { query, queryOne } from "@/server/db/client";

export const SESSION_COOKIE = "dot_session";
/** Sliding window: an active session keeps moving this far into the future. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Hard ceiling measured from sign-in, so a session cannot slide forever. */
const ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SLIDING_REFRESH_MS = 24 * 60 * 60 * 1000; // extend when < 24h of activity

/**
 * Opaque server-side sessions. The browser holds a random token in an
 * HttpOnly cookie; the database stores only its SHA-256 hash. Revoking a
 * session is a row delete. An external identity provider (e.g. Firebase) can
 * be plugged in at sign-in time and still produce one of these sessions.
 */

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<{ token: string; session: SessionRecord }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const requestHeaders = await headers();
  const row = await queryOne<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      userId,
      hashToken(token),
      expiresAt,
      requestHeaders.get("user-agent")?.slice(0, 512) ?? null,
      requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    ],
  );
  if (!row) throw new Error("Failed to create session");
  return { token, session: { id: row.id, userId, expiresAt } };
}

export async function setSessionCookie(token: string, _expiresAt: Date): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getServerEnv().NODE_ENV === "production",
    path: "/",
    // The cookie outlives the sliding window on purpose: the database row is
    // the only source of truth for expiry. A cookie that died first would log
    // out an active user whose session had been extended server-side, and a
    // Server Component cannot re-issue it mid-request.
    expires: new Date(Date.now() + ABSOLUTE_TTL_MS),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  expiresAt: Date;
}

/** Reads the cookie and resolves the session row, extending it when active. */
export async function resolveSessionFromCookie(): Promise<ResolvedSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return resolveSessionFromToken(token);
}

export async function resolveSessionFromToken(token: string): Promise<ResolvedSession | null> {
  const row = await queryOne<{ id: string; user_id: string; expires_at: Date; last_seen_at: Date; created_at: Date }>(
    `SELECT id, user_id, expires_at, last_seen_at, created_at FROM sessions WHERE token_hash = $1`,
    [hashToken(token)],
  );
  if (!row) return null;

  const now = Date.now();
  const absoluteDeadline = row.created_at.getTime() + ABSOLUTE_TTL_MS;
  if (row.expires_at.getTime() <= now || absoluteDeadline <= now) {
    await query("DELETE FROM sessions WHERE id = $1", [row.id]);
    return null;
  }

  if (now - row.last_seen_at.getTime() > SLIDING_REFRESH_MS) {
    // Never slide past the absolute deadline.
    const expiresAt = new Date(Math.min(now + SESSION_TTL_MS, absoluteDeadline));
    // Fire-and-forget refresh; failure here must not break the request.
    void query("UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE id = $1", [row.id, expiresAt]).catch(
      () => undefined,
    );
  }
  return { sessionId: row.id, userId: row.user_id, expiresAt: row.expires_at };
}

export async function destroySession(sessionId: string): Promise<void> {
  await query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}

export async function destroyAllUserSessions(userId: string): Promise<void> {
  await query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}
