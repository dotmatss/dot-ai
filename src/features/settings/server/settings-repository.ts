import "server-only";

import { describeUserAgent, truncateUserAgent } from "@/features/settings/user-agent";
import type {
  OrganizationMember,
  UsageKindTotal,
  UserProfile,
  UserSessionSummary,
} from "@/features/settings/types";
import type { MemberRole } from "@/features/workspaces/roles";
import { query, queryOne, type Queryable } from "@/server/db/client";
import { toIsoRequired } from "@/server/db/sql";

/**
 * All settings SQL.
 *
 * `usage_events` is workspace-scoped and filtered on `workspace_id` like every
 * other tenant table. `organization_members`, `users` and `sessions` are not:
 * they have no `workspace_id` column, so Row Level Security does not scope them
 * and the explicit filter here is the *only* boundary. Every function therefore
 * takes the organization id or user id that the caller's verified membership
 * resolved to - never one that arrived in a request.
 */

/* -------------------------------------------------------------------------- */
/* Organization members                                                        */
/* -------------------------------------------------------------------------- */

interface MemberRow {
  user_id: string;
  role: MemberRole;
  created_at: Date;
  name: string;
  email: string;
  avatar_url: string | null;
}

// `email` is citext; casting to text keeps the driver's value a plain string.
const MEMBER_COLUMNS = `
  m.user_id, m.role, m.created_at, u.name, u.email::text AS email, u.avatar_url
`;

/** Owners first, then admins, members, viewers; alphabetical inside each rank. */
const MEMBER_ORDER = `
  ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
           lower(u.name), u.id
`;

function mapMember(row: MemberRow, currentUserId: string): OrganizationMember {
  return {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    role: row.role,
    joinedAt: toIsoRequired(row.created_at),
    isCurrentUser: row.user_id === currentUserId,
  };
}

export async function listOrganizationMembers(
  organizationId: string,
  currentUserId: string,
  client?: Queryable,
): Promise<OrganizationMember[]> {
  const rows = await query<MemberRow>(
    `SELECT ${MEMBER_COLUMNS}
     FROM organization_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = $1
     ${MEMBER_ORDER}`,
    [organizationId],
    client,
  );
  return rows.map((row) => mapMember(row, currentUserId));
}

export async function findOrganizationMember(
  organizationId: string,
  userId: string,
  currentUserId: string,
  client?: Queryable,
): Promise<OrganizationMember | null> {
  const row = await queryOne<MemberRow>(
    `SELECT ${MEMBER_COLUMNS}
     FROM organization_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = $1 AND m.user_id = $2`,
    [organizationId, userId],
    client,
  );
  return row ? mapMember(row, currentUserId) : null;
}

/**
 * Owner ids, with the rows locked for the rest of the transaction.
 *
 * The last-owner rule is a read-then-write, so two admins demoting the two
 * remaining owners at the same time would each read `ownerCount = 2` and both
 * succeed. `FOR UPDATE` serialises them. It returns ids rather than a count
 * because PostgreSQL rejects `FOR UPDATE` alongside an aggregate.
 */
export async function lockOrganizationOwnerIds(organizationId: string, client: Queryable): Promise<string[]> {
  const rows = await query<{ user_id: string }>(
    "SELECT user_id FROM organization_members WHERE organization_id = $1 AND role = 'owner' FOR UPDATE",
    [organizationId],
    client,
  );
  return rows.map((row) => row.user_id);
}

export async function updateOrganizationMemberRole(
  organizationId: string,
  userId: string,
  role: MemberRole,
  client: Queryable,
): Promise<boolean> {
  const row = await queryOne<{ user_id: string }>(
    `UPDATE organization_members SET role = $3
     WHERE organization_id = $1 AND user_id = $2
     RETURNING user_id`,
    [organizationId, userId, role],
    client,
  );
  return row !== null;
}

export async function deleteOrganizationMember(
  organizationId: string,
  userId: string,
  client: Queryable,
): Promise<boolean> {
  const row = await queryOne<{ user_id: string }>(
    `DELETE FROM organization_members
     WHERE organization_id = $1 AND user_id = $2
     RETURNING user_id`,
    [organizationId, userId],
    client,
  );
  return row !== null;
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

interface SessionRow {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
}

/**
 * `token_hash` is not in this list and must never be: the hash is the only
 * server-side secret that identifies a session, and a list endpoint has no use
 * for it.
 */
const SESSION_COLUMNS = "id, user_agent, ip_address, created_at, last_seen_at, expires_at";

function mapSession(row: SessionRow, currentSessionId: string): UserSessionSummary {
  const device = describeUserAgent(row.user_agent);
  return {
    id: row.id,
    deviceLabel: device.label,
    browser: device.browser,
    operatingSystem: device.operatingSystem,
    userAgent: truncateUserAgent(row.user_agent),
    ipAddress: row.ip_address,
    createdAt: toIsoRequired(row.created_at),
    lastSeenAt: toIsoRequired(row.last_seen_at),
    expiresAt: toIsoRequired(row.expires_at),
    isCurrent: row.id === currentSessionId,
  };
}

/** Live sessions for one user, most recently active first. Expired rows are skipped. */
export async function listUserSessions(userId: string, currentSessionId: string): Promise<UserSessionSummary[]> {
  const rows = await query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM sessions
     WHERE user_id = $1 AND expires_at > now()
     ORDER BY last_seen_at DESC, created_at DESC`,
    [userId],
  );
  return rows.map((row) => mapSession(row, currentSessionId));
}

/** Ownership check before a revoke: a session id alone must never be enough. */
export async function findUserSessionId(userId: string, sessionId: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>("SELECT id FROM sessions WHERE user_id = $1 AND id = $2", [
    userId,
    sessionId,
  ]);
  return row?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

interface UserRow {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

function mapProfile(row: UserRow): UserProfile {
  return { id: row.id, name: row.name, email: row.email, avatarUrl: row.avatar_url };
}

export async function findUserProfile(userId: string): Promise<UserProfile | null> {
  const row = await queryOne<UserRow>("SELECT id, name, email::text AS email, avatar_url FROM users WHERE id = $1", [
    userId,
  ]);
  return row ? mapProfile(row) : null;
}

/** Email is not updatable here: it is the login identity, changed through auth. */
export async function updateUserProfile(
  userId: string,
  input: { name: string; avatarUrl: string | null },
): Promise<UserProfile | null> {
  const row = await queryOne<UserRow>(
    `UPDATE users SET name = $2, avatar_url = $3
     WHERE id = $1
     RETURNING id, name, email::text AS email, avatar_url`,
    [userId, input.name, input.avatarUrl],
  );
  return row ? mapProfile(row) : null;
}

/* -------------------------------------------------------------------------- */
/* Usage                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Metered usage for one workspace over the last `days` days, one row per
 * `kind`. `quantity` is `bigint`, which the driver returns as a string, so the
 * sum is widened through `Number` exactly once, here.
 */
export async function sumUsageByKind(workspaceId: string, days: number): Promise<UsageKindTotal[]> {
  const rows = await query<{ kind: string; total: string; events: string }>(
    `SELECT kind, coalesce(sum(quantity), 0)::text AS total, count(*)::text AS events
     FROM usage_events
     WHERE workspace_id = $1 AND occurred_at >= now() - ($2::int * interval '1 day')
     GROUP BY kind
     ORDER BY kind`,
    [workspaceId, days],
  );
  return rows.map((row) => ({ kind: row.kind, total: Number(row.total), events: Number(row.events) }));
}
