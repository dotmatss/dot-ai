import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { forbidden, notFound, redirect, unauthorized } from "next/navigation";
import { cache } from "react";

import { findUserByIdentity } from "@/features/auth/server/auth-service";
import { FIREBASE_PROVIDER } from "@/features/auth/server/firebase-auth-service";
import type { OrganizationStatus } from "@/features/platform/types";
import { hasMinimumRole, type MemberRole } from "@/features/workspaces/roles";
import type { CurrentUser, WorkspaceMembership } from "@/features/workspaces/types";
import { ApiError } from "@/lib/api/api-error";
import {
  firebaseIdTokenFrom,
  FirebaseTokenError,
  isFirebaseConfigured,
  verifyFirebaseIdToken,
} from "@/server/auth/firebase/verify-id-token";
import { resolveSessionFromCookie, type ResolvedSession } from "@/server/auth/session";
import { withDb } from "@/server/db/client";
import { organizationMembers, organizations, users, workspaces } from "@/server/db/schema";
import { toIsoRequired } from "@/server/db/sql";

/**
 * Data Access Layer for authentication and authorization. Every Server
 * Component, Server Action and Route Handler that touches tenant data obtains
 * its identity and workspace context here, never from client-provided state.
 */

/**
 * How the caller proved who they are.
 *
 * `"session"` is the application's own cookie and is what every browser
 * navigation uses. `"firebase-token"` is an `Authorization: Bearer` ID token,
 * accepted only on the API surface for programmatic clients.
 *
 * Worth distinguishing because the two are not interchangeable for everything:
 * a token-authenticated request has no session row, so it has no "current
 * session" to mark in the sessions list and nothing to revoke on sign-out.
 */
export type AuthCredentialKind = "session" | "firebase-token";

export interface AuthContext {
  /** Null when the caller authenticated with a Bearer ID token. */
  session: ResolvedSession | null;
  user: CurrentUser;
  credential: AuthCredentialKind;
}

/**
 * Memoized per request so layouts and pages share one lookup.
 *
 * `disabled_at IS NULL` is part of the predicate rather than a check on the
 * result: an account disabled by the platform plane (migration 0023) must
 * resolve to no session at all, so every caller of this DAL - page, Server
 * Action and route handler alike - treats it as signed out without any of them
 * having to know the column exists. `changeUserState` additionally deletes the
 * account's session rows, so this is the second layer rather than the only one.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await resolveSessionFromCookie();
  if (!session) return null;
  const userRows = await withDb((db) =>
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(and(eq(users.id, session.userId), isNull(users.disabledAt)))
      .limit(1),
  );
  const user = userRows[0];
  if (!user) return null;
  return {
    session,
    credential: "session",
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerified,
    },
  };
});

/**
 * The same account lookup, for a user id that some other credential has
 * already proved. Shares the `disabled_at IS NULL` predicate with
 * `getAuthContext` so a disabled account is signed out on every path, not just
 * the cookie one.
 */
async function loadActiveUser(userId: string): Promise<CurrentUser | null> {
  const rows = await withDb((db) =>
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.disabledAt)))
      .limit(1),
  );
  const user = rows[0];
  return user
    ? { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, emailVerified: user.emailVerified }
    : null;
}

/**
 * Authentication for API callers, which may present either credential.
 *
 * The cookie is tried first, so an ordinary browser request costs exactly what
 * it did before: one memoized lookup, no header parsing, no token work.
 *
 * ── The Bearer path ─────────────────────────────────────────────────────────
 *
 * This is §6 and §22 as they apply to a programmatic client: extract the
 * token, verify it with Google's published keys, read the UID from the
 * VERIFIED claims, resolve it through `user_identities` to an application
 * user, and attach that user to the request. Not one of those steps consults
 * anything else the client sent - there is no `userId` parameter anywhere in
 * this codebase that can name the caller, and a request adding one would have
 * it ignored.
 *
 * Authorization is untouched by which credential was used. The context this
 * returns feeds the same `requireApiWorkspaceAccess` and
 * `requireApiPlatformAccess` as a cookie, which read
 * `organization_members.role` and `platform_admins` from PostgreSQL. A valid
 * Firebase token for a disabled account, or for someone with no membership,
 * gets exactly as far here as a valid cookie for one: nowhere.
 *
 * `firebaseIdTokenFrom` requires a three-part JWT, so the opaque developer API
 * keys that share this header fall through to `authenticateApiKey` untouched.
 */
const getBearerAuthContext = cache(async (): Promise<AuthContext | null> => {
  if (!isFirebaseConfigured()) return null;

  const requestHeaders = await headers();
  const idToken = firebaseIdTokenFrom(requestHeaders.get("authorization"));
  if (!idToken) return null;

  let claims;
  try {
    claims = await verifyFirebaseIdToken(idToken);
  } catch (error) {
    if (error instanceof FirebaseTokenError) {
      console.warn("[auth] rejected Bearer ID token:", error.reason);
      return null;
    }
    // Google unreachable, or a misconfiguration. Not the caller's fault, and
    // not something to report as "unauthenticated" - that would tell an
    // operator their credentials are wrong during someone else's outage.
    console.error("[auth] could not verify Bearer ID token", error);
    throw ApiError.unavailable("Could not verify your credentials right now. Try again in a moment.");
  }

  const linked = await findUserByIdentity(FIREBASE_PROVIDER, claims.uid);
  if (!linked) return null;
  const user = await loadActiveUser(linked.id);
  if (!user) return null;

  return { session: null, credential: "firebase-token", user };
});

/** For pages: renders the 401 segment when unauthenticated. */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) unauthorized();
  return ctx;
}

/** For pages that should bounce to sign-in instead of rendering a 401 view. */
export async function requireAuthOrRedirect(next?: string): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  return ctx;
}

/**
 * Signed in AND verified, for pages outside a workspace that still create or
 * expose tenant state.
 *
 * `/onboarding` is the one that matters today: it creates workspaces, and it
 * is reached precisely by accounts that have no workspace yet - so
 * `requireWorkspaceAccess`, which carries the gate for everything under
 * `/w/[slug]`, by definition never runs for it. Without this an unverified
 * account could build the workspace it is not yet allowed to enter.
 */
export async function requireVerifiedAuthOrRedirect(next?: string): Promise<AuthContext> {
  const auth = await requireAuthOrRedirect(next);
  requireVerifiedEmail(auth);
  return auth;
}

/**
 * For route handlers: throws an ApiError instead of rendering.
 *
 * Accepts the session cookie or an `Authorization: Bearer <firebase-id-token>`,
 * in that order. Pages deliberately do not get the Bearer path: a browser
 * navigation cannot carry the header, so offering it there would be a branch
 * that never runs.
 */
export async function requireApiAuth(): Promise<AuthContext> {
  const ctx = (await getAuthContext()) ?? (await getBearerAuthContext());
  if (!ctx) throw ApiError.unauthorized();
  return ctx;
}

/**
 * For route handlers behind the verified-email gate.
 *
 * Reads `users.email_verified`, which the server writes from a verified token
 * and nothing else can set. The 403 names the requirement because the caller
 * can act on it; it discloses nothing they do not already know about their own
 * account.
 */
export async function requireApiVerifiedAuth(): Promise<AuthContext> {
  const ctx = await requireApiAuth();
  if (!ctx.user.emailVerified) {
    throw ApiError.forbidden("Verify your email address to use this feature.");
  }
  return ctx;
}

function mapMembership(row: {
  workspace_id: string; workspace_name: string; workspace_slug: string; workspace_created_at: Date;
  organization_id: string; organization_name: string; organization_slug: string; organization_status: OrganizationStatus; role: MemberRole;
}): WorkspaceMembership {
  return {
    workspace: {
      id: row.workspace_id,
      organizationId: row.organization_id,
      name: row.workspace_name,
      slug: row.workspace_slug,
      createdAt: toIsoRequired(row.workspace_created_at),
    },
    organization: { id: row.organization_id, name: row.organization_name, slug: row.organization_slug },
    role: row.role,
    organizationStatus: row.organization_status,
  };
}

/**
 * Resolves the caller's membership for a workspace slug, or null when none.
 *
 * Deliberately does NOT filter on the organization's platform status. Folding
 * `o.status = 'active'` into this predicate would make a suspended tenant's
 * workspaces indistinguishable from deleted ones to their own members, and
 * would throw away the value the guards need in order to explain the refusal.
 * Membership is a fact; whether it currently grants access is a decision, and
 * the decision belongs in the guards below.
 */
export const getWorkspaceMembership = cache(
  async (userId: string, workspaceSlug: string): Promise<WorkspaceMembership | null> => {
    const rows = await withDb((db) =>
      db
        .select({
          workspace_id: workspaces.id,
          workspace_name: workspaces.name,
          workspace_slug: workspaces.slug,
          workspace_created_at: workspaces.createdAt,
          organization_id: organizations.id,
          organization_name: organizations.name,
          organization_slug: organizations.slug,
          organization_status: organizations.status,
          role: organizationMembers.role,
        })
        .from(workspaces)
        .innerJoin(organizations, eq(organizations.id, workspaces.organizationId))
        .innerJoin(organizationMembers, and(eq(organizationMembers.organizationId, organizations.id), eq(organizationMembers.userId, userId)))
        .where(eq(workspaces.slug, workspaceSlug))
        .orderBy(asc(workspaces.id))
        .limit(1),
    );
    return rows[0] ? mapMembership(rows[0]) : null;
  },
);

export interface WorkspaceContext extends AuthContext {
  membership: WorkspaceMembership;
}

/**
 * Whether the organization's platform lifecycle currently permits access.
 *
 * One predicate, used by both guards, so the page and the API can never
 * disagree about whether a tenant is open. Every organization is `active`
 * unless a platform operator explicitly moved it, so this is inert for every
 * tenant that existed before migration 0023.
 */
function organizationIsOpen(membership: WorkspaceMembership): boolean {
  return membership.organizationStatus === "active";
}

/**
 * For pages inside /w/[workspaceSlug]. Unknown or inaccessible workspaces
 * render as 404 so their existence is not leaked; insufficient role is 403,
 * and so is a workspace whose organization the platform has closed.
 *
 * A suspended tenant is deliberately 403 and not 404: the member knows their
 * workspace exists, and telling them it does not would read as data loss.
 */
export async function requireWorkspaceAccess(workspaceSlug: string, minimumRole: MemberRole = "viewer"): Promise<WorkspaceContext> {
  const auth = await requireAuthOrRedirect(`/w/${workspaceSlug}`);
  requireVerifiedEmail(auth);
  const membership = await getWorkspaceMembership(auth.user.id, workspaceSlug);
  if (!membership) notFound();
  if (!organizationIsOpen(membership)) forbidden();
  if (!hasMinimumRole(membership.role, minimumRole)) forbidden();
  return { ...auth, membership };
}

/**
 * The `AUTHENTICATED_VERIFIED` half of the state machine in §17, enforced in
 * the one place every workspace page already passes through.
 *
 * Put here rather than in `proxy.ts` because the proxy sees a cookie, not an
 * account: it cannot know whether the address behind that cookie is verified
 * without a database read it is not allowed to do. Here the account has already
 * been loaded, so the check costs nothing extra.
 *
 * ── Why this cannot loop ────────────────────────────────────────────────────
 *
 * `/verify-email` is reached through `requireAuthOrRedirect`, never through
 * this guard, and it is in the proxy's authenticated set rather than its public
 * one. So the only edge is protected-page -> /verify-email, and there is no
 * edge back until `users.email_verified` is true - at which point this function
 * stops redirecting at all.
 *
 * A deployment without Firebase never reaches the redirect either: accounts
 * that predate this were grandfathered by migration 0029, and the built-in
 * password path creates its accounts verified on purpose - it has no way to
 * verify an address, so `false` there would mean "permanently stuck at
 * /verify-email" rather than "unverified". See `PASSWORD_PATH_EMAIL_VERIFIED`.
 */
function requireVerifiedEmail(auth: AuthContext): void {
  if (!auth.user.emailVerified) redirect("/verify-email");
}

/** For route handlers: same rules, expressed as ApiErrors. */
export async function requireApiWorkspaceAccess(workspaceSlug: string, minimumRole: MemberRole = "viewer"): Promise<WorkspaceContext> {
  const auth = await requireApiAuth();
  // Before the membership lookup, so an unverified caller gets the same answer
  // whether or not the workspace exists - and cannot use the difference
  // between 403 and 404 to find out which slugs are real.
  if (!auth.user.emailVerified) throw ApiError.forbidden("Verify your email address to use this feature.");
  const membership = await getWorkspaceMembership(auth.user.id, workspaceSlug);
  if (!membership) throw ApiError.notFound("Workspace not found");
  // Checked before the role, so a suspended tenant gets the same answer
  // whatever the caller's role is - otherwise the status of an organization
  // would be inferable from which error a viewer versus an admin received.
  if (!organizationIsOpen(membership)) {
    throw ApiError.forbidden("This organization is not active. Contact support.");
  }
  if (!hasMinimumRole(membership.role, minimumRole)) throw ApiError.forbidden();
  return { ...auth, membership };
}
