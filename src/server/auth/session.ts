import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { cookies, headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";

import { getServerEnv } from "@/config/env";
import { queryOne, withDb } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";

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

/**
 * Mints a session, but only for an account that exists and is not disabled.
 *
 * `INSERT ... SELECT` rather than a check followed by an insert, so the guard
 * and the write are one statement: there is no window in which an account
 * disabled a moment ago still receives a session. `authenticateWithPassword`
 * already refuses a disabled account, which makes this the second layer, not
 * the only one.
 *
 * Deliberately raw SQL. Drizzle's `insert().select()` requires the projection
 * to match the table definition column-for-column and in order, which this
 * cannot do - it supplies five of `sessions`' eight columns and lets the
 * defaults fill the rest. Expressing it through the query builder therefore
 * meant either listing defaulted columns by hand or splitting the statement in
 * two and losing the atomicity that is the whole point. This is exactly the
 * "leave SQL-shaped queries as SQL" case in docs/feature-conventions.md.
 */
export async function createSession(userId: string): Promise<{ token: string; session: SessionRecord }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const requestHeaders = await headers();
  const row = await queryOne<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip_address)
     SELECT u.id, $2, $3, $4, $5
     FROM users u
     WHERE u.id = $1 AND u.disabled_at IS NULL
     RETURNING id`,
    [
      userId,
      hashToken(token),
      expiresAt,
      requestHeaders.get("user-agent")?.slice(0, 512) ?? null,
      requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    ],
  );
  // No row means the account vanished or was disabled between authentication
  // and now. The message stays generic: the caller has already proved the
  // password, so there is nothing to disclose by being specific, and nothing
  // useful it could do differently.
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
  const rows = await withDb((db) =>
    db
      .select({
        id: sessions.id,
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
        lastSeenAt: sessions.lastSeenAt,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(users.disabledAt)))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;

  const now = Date.now();
  const absoluteDeadline = row.createdAt.getTime() + ABSOLUTE_TTL_MS;
  if (row.expiresAt.getTime() <= now || absoluteDeadline <= now) {
    await withDb((db) => db.delete(sessions).where(eq(sessions.id, row.id)));
    return null;
  }

  if (now - row.lastSeenAt.getTime() > SLIDING_REFRESH_MS) {
    // Never slide past the absolute deadline.
    const expiresAt = new Date(Math.min(now + SESSION_TTL_MS, absoluteDeadline));
    // Fire-and-forget refresh; failure here must not break the request.
    void withDb((db) => db.update(sessions).set({ lastSeenAt: new Date(), expiresAt }).where(eq(sessions.id, row.id))).catch(
      () => undefined,
    );
  }
  return { sessionId: row.id, userId: row.userId, expiresAt: row.expiresAt };
}

export async function destroySession(sessionId: string): Promise<void> {
  await withDb((db) => db.delete(sessions).where(eq(sessions.id, sessionId)));
}

export async function destroyAllUserSessions(userId: string): Promise<void> {
  await withDb((db) => db.delete(sessions).where(eq(sessions.userId, userId)));
}
