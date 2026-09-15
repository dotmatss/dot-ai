import "server-only";

import { eq } from "drizzle-orm";

import { ApiError } from "@/lib/api/api-error";
import { withDb } from "@/server/db/client";
import { organizations, users, workspaces } from "@/server/db/schema";

/**
 * Runtime lifecycle guards for surfaces that have no session to check.
 *
 * `requireWorkspaceAccess` already refuses a suspended organization, but it
 * only runs where somebody is signed in. The widget, the public chat API and
 * any other anonymous or key-authenticated channel identify a *chatbot*, never
 * a member, so without these a suspended tenant's bots would keep answering and
 * keep spending tokens - which would make "suspended" a dashboard label rather
 * than a control.
 *
 * ── Fail closed ─────────────────────────────────────────────────────────────
 *
 * Both functions refuse when the row is missing and when the status is
 * anything other than `active`, including a value this code does not recognise.
 * A future status added by a migration is therefore closed by default and has
 * to be opened deliberately, rather than being silently treated as open because
 * it did not match `'suspended'`.
 *
 * ── Why the error says nothing ──────────────────────────────────────────────
 *
 * A 503 with a generic message. An anonymous visitor on a customer's website
 * must not be told that the customer was suspended - that is the customer's
 * commercial business, disclosed to whoever loads the page. The operator learns
 * the reason from the platform plane; the visitor learns only that the
 * assistant is unavailable.
 */

const UNAVAILABLE = "This assistant is currently unavailable.";

/**
 * Refuses unless the workspace's organization is active.
 *
 * One indexed lookup by primary key through the workspace's organization. Call
 * it on the request path of a public channel, before any model spend.
 */
export async function assertWorkspaceActive(workspaceId: string): Promise<void> {
  const rows = await withDb((db) =>
    db.select({ status: organizations.status }).from(workspaces).innerJoin(organizations, eq(organizations.id, workspaces.organizationId)).where(eq(workspaces.id, workspaceId)).limit(1),
  );
  const row = rows[0];

  if (!row || row.status !== "active") throw ApiError.unavailable(UNAVAILABLE);
}

/**
 * Refuses unless the account exists and is not disabled.
 *
 * The session DAL already filters disabled accounts out of `getAuthContext`,
 * so this is for paths that resolve a user id from something other than a
 * session cookie - an API key's creator, a stored actor on a queued job - where
 * that filter never ran.
 */
export async function assertUserActive(userId: string): Promise<void> {
  const rows = await withDb((db) => db.select({ disabledAt: users.disabledAt }).from(users).where(eq(users.id, userId)).limit(1));
  const row = rows[0];

  if (!row || row.disabledAt) throw ApiError.unauthorized("This account is not active.");
}
