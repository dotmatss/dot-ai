import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { ApiError } from "@/lib/api/api-error";
import { requireApiVerifiedAuth, requireAuthOrRedirect, type AuthContext } from "@/server/auth/dal";
import { withDb } from "@/server/db/client";
import { platformAdmins } from "@/server/db/schema";
import { toIsoRequired } from "@/server/db/sql";

/**
 * Authorization for the PLATFORM plane.
 *
 * This is the second of the application's two administrative boundaries, and
 * the whole point is that it does not touch the first one:
 *
 *     Platform            requirePlatformAccess()      platform_admins
 *     └── Customer orgs   requireWorkspaceAccess()     organization_members.role
 *
 * There is no path between them. `organization_members.role` is resolved for
 * one workspace at a time and answers "what may this member do in this
 * tenant"; it can never answer "may this person operate the platform". Holding
 * `owner` on every organization in the database grants nothing here, because
 * nothing here reads that table.
 *
 * Grants are made out of band by `scripts/grant-platform-admin.mjs`. There is
 * deliberately no route, Server Action or service that writes to
 * `platform_admins`, so the boundary cannot be widened by an HTTP request at
 * all - not even by someone who already holds it.
 *
 * ── Why a missing grant is 404 and not 403 ──────────────────────────────────
 *
 * The same reasoning the agent routes already use: confirming that a resource
 * exists to someone who may not have it is itself a disclosure. A 403 tells an
 * authenticated customer that /admin is real and that the only thing between
 * them and it is a flag; a 404 tells them nothing. Unauthenticated callers
 * still get 401, because a sign-in redirect has to remain possible.
 *
 * ── Step-up authentication ──────────────────────────────────────────────────
 *
 * Not required today. The seam is that EVERY page and route in the platform
 * plane passes through `requirePlatformAccess`/`requireApiPlatformAccess` and
 * nothing else re-implements the check - `tests/unit/platform-authorization.test.ts`
 * enforces that. Adding a step-up requirement (a fresh password confirmation
 * that marks `sessions.id` elevated for a short window) is therefore a change
 * to these two functions plus one route, not a change to every handler.
 */

export interface PlatformGrant {
  userId: string;
  grantedAt: string;
  note: string | null;
}

export interface PlatformContext extends AuthContext {
  grant: PlatformGrant;
}

/**
 * The live grant for a user, or null.
 *
 * Revoked grants are excluded here rather than by callers: a revoked row must
 * never be one forgotten `WHERE` away from authorizing someone. Memoized per
 * request like the rest of the DAL, so a layout and its pages share one lookup.
 */
export const getPlatformGrant = cache(async (userId: string): Promise<PlatformGrant | null> => {
  const rows = await withDb((db) =>
    db
      .select({ userId: platformAdmins.userId, grantedAt: platformAdmins.grantedAt, note: platformAdmins.note })
      .from(platformAdmins)
      .where(and(eq(platformAdmins.userId, userId), isNull(platformAdmins.revokedAt)))
      .limit(1),
  );
  const row = rows[0];
  return row ? { userId: row.userId, grantedAt: toIsoRequired(row.grantedAt), note: row.note } : null;
});

/** True when the caller holds a live platform grant. For UI gating only. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  return (await getPlatformGrant(userId)) !== null;
}

/**
 * For pages under /admin. Signed-out visitors are bounced to sign-in; signed-in
 * non-admins get the 404 segment, so the plane's existence is not confirmed.
 */
export async function requirePlatformAccess(): Promise<PlatformContext> {
  const auth = await requireAuthOrRedirect("/admin");
  // The verification gate applies here too, and before the grant lookup: an
  // operator account is the last one that should be reachable from an
  // unconfirmed address. Checking first also keeps the answer identical for
  // operators and non-operators, so the redirect cannot be used to discover
  // whether an account holds a grant.
  if (!auth.user.emailVerified) redirect("/verify-email");
  const grant = await getPlatformGrant(auth.user.id);
  if (!grant) notFound();
  return { ...auth, grant };
}

/** For route handlers under /api/admin. Same rules, expressed as ApiErrors. */
export async function requireApiPlatformAccess(): Promise<PlatformContext> {
  const auth = await requireApiVerifiedAuth();
  const grant = await getPlatformGrant(auth.user.id);
  if (!grant) throw ApiError.notFound();
  return { ...auth, grant };
}
