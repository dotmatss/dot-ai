import "server-only";

import { forbidden, notFound, redirect, unauthorized } from "next/navigation";
import { cache } from "react";

import { hasMinimumRole, type MemberRole } from "@/features/workspaces/roles";
import type { CurrentUser, WorkspaceMembership } from "@/features/workspaces/types";
import { ApiError } from "@/lib/api/api-error";
import { resolveSessionFromCookie, type ResolvedSession } from "@/server/auth/session";
import { queryOne } from "@/server/db/client";
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

interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

/** Memoized per request so layouts and pages share one lookup. */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await resolveSessionFromCookie();
  if (!session) return null;
  const user = await queryOne<UserRow>("SELECT id, email, name, avatar_url FROM users WHERE id = $1", [session.userId]);
  if (!user) return null;
  return {
    session,
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url },
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

interface MembershipRow {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  workspace_created_at: Date;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  role: MemberRole;
}

const MEMBERSHIP_SQL = `
  SELECT w.id AS workspace_id, w.name AS workspace_name, w.slug AS workspace_slug, w.created_at AS workspace_created_at,
         o.id AS organization_id, o.name AS organization_name, o.slug AS organization_slug,
         m.role
  FROM workspaces w
  JOIN organizations o ON o.id = w.organization_id
  JOIN organization_members m ON m.organization_id = o.id AND m.user_id = $1
`;

function mapMembership(row: MembershipRow): WorkspaceMembership {
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
  };
}

/** Resolves the caller's membership for a workspace slug, or null when none. */
export const getWorkspaceMembership = cache(
  async (userId: string, workspaceSlug: string): Promise<WorkspaceMembership | null> => {
    const row = await queryOne<MembershipRow>(`${MEMBERSHIP_SQL} WHERE w.slug = $2`, [userId, workspaceSlug]);
    return row ? mapMembership(row) : null;
  },
);

export interface WorkspaceContext extends AuthContext {
  membership: WorkspaceMembership;
}

/**
 * For pages inside /w/[workspaceSlug]. Unknown or inaccessible workspaces
 * render as 404 so their existence is not leaked; insufficient role is 403.
 */
export async function requireWorkspaceAccess(workspaceSlug: string, minimumRole: MemberRole = "viewer"): Promise<WorkspaceContext> {
  const auth = await requireAuthOrRedirect(`/w/${workspaceSlug}`);
  const membership = await getWorkspaceMembership(auth.user.id, workspaceSlug);
  if (!membership) notFound();
  if (!hasMinimumRole(membership.role, minimumRole)) forbidden();
  return { ...auth, membership };
}

/** For route handlers: same rules, expressed as ApiErrors. */
export async function requireApiWorkspaceAccess(workspaceSlug: string, minimumRole: MemberRole = "viewer"): Promise<WorkspaceContext> {
  const auth = await requireApiAuth();
  const membership = await getWorkspaceMembership(auth.user.id, workspaceSlug);
  if (!membership) throw ApiError.notFound("Workspace not found");
  if (!hasMinimumRole(membership.role, minimumRole)) throw ApiError.forbidden();
  return { ...auth, membership };
}
