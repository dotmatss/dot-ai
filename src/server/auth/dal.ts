import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { forbidden, notFound, redirect, unauthorized } from "next/navigation";
import { cache } from "react";

import type { OrganizationStatus } from "@/features/platform/types";
import { hasMinimumRole, type MemberRole } from "@/features/workspaces/roles";
import type { CurrentUser, WorkspaceMembership } from "@/features/workspaces/types";
import { ApiError } from "@/lib/api/api-error";
import { resolveSessionFromCookie, type ResolvedSession } from "@/server/auth/session";
import { withDb } from "@/server/db/client";
import { organizationMembers, organizations, users, workspaces } from "@/server/db/schema";
import { toIsoRequired } from "@/server/db/sql";

/**
 * Data Access Layer for authentication and authorization. Every Server
 * Component, Server Action and Route Handler that touches tenant data obtains
 * its identity and workspace context here, never from client-provided state.
 */

export interface AuthContext {
  session: ResolvedSession;
  user: CurrentUser;
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
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerified,
    },
  };
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

/** For route handlers: throws an ApiError instead of rendering. */
export async function requireApiAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw ApiError.unauthorized();
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
  const membership = await getWorkspaceMembership(auth.user.id, workspaceSlug);
  if (!membership) notFound();
  if (!organizationIsOpen(membership)) forbidden();
  if (!hasMinimumRole(membership.role, minimumRole)) forbidden();
  return { ...auth, membership };
}

/** For route handlers: same rules, expressed as ApiErrors. */
export async function requireApiWorkspaceAccess(workspaceSlug: string, minimumRole: MemberRole = "viewer"): Promise<WorkspaceContext> {
  const auth = await requireApiAuth();
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
