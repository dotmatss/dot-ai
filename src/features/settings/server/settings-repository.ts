import "server-only";

import { and, asc, desc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import { describeUserAgent, truncateUserAgent } from "@/features/settings/user-agent";
import {
  STORAGE_CATEGORIES,
  type InvitationPreview,
  type InvitationStatus,
  type OrganizationInvitation,
  type OrganizationMember,
  type StorageCategory,
  type StorageCategoryTotal,
  type UsageKindTotal,
  type UserProfile,
  type UserSessionSummary,
} from "@/features/settings/types";
import type { MemberRole } from "@/features/workspaces/roles";
import { withDb, type DatabaseClient } from "@/server/db/client";
import {
  activityLog,
  contactNotes,
  knowledgeChunks,
  knowledgeSources,
  messages,
  organizationInvitations,
  organizationMembers,
  organizations,
  sessions,
  usageEvents,
  users,
} from "@/server/db/schema";
import { toIsoRequired } from "@/server/db/sql";

/**
 * All settings persistence.
 *
 * `usage_events` is workspace-scoped and filtered on `workspace_id` like every
 * other tenant table. `organization_members`, `users` and `sessions` are not:
 * they have no `workspace_id` column, so Row Level Security does not scope them
 * and the explicit filter here is the *only* boundary. Every function therefore
 * takes the organization id or user id that the caller's verified membership
 * resolved to - never one that arrived in a request.
 *
 * `email` columns are `citext`. The comparisons below send a plain text
 * parameter exactly as the hand-written SQL did, so matching stays
 * case-insensitive in the database rather than in TypeScript.
 */

/* -------------------------------------------------------------------------- */
/* Organization members                                                        */
/* -------------------------------------------------------------------------- */

interface MemberRow {
  userId: string;
  role: MemberRole;
  createdAt: Date;
  name: string;
  email: string;
  avatarUrl: string | null;
}

const memberSelection = {
  userId: organizationMembers.userId,
  role: organizationMembers.role,
  createdAt: organizationMembers.createdAt,
  name: users.name,
  email: users.email,
  avatarUrl: users.avatarUrl,
};

/** Owners first, then admins, members, viewers; alphabetical inside each rank. */
const memberOrder = [
  sql`CASE ${organizationMembers.role} WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END`,
  sql`lower(${users.name})`,
  asc(users.id),
];

function mapMember(row: MemberRow, currentUserId: string): OrganizationMember {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatarUrl,
    role: row.role,
    joinedAt: toIsoRequired(row.createdAt),
    isCurrentUser: row.userId === currentUserId,
  };
}

export async function listOrganizationMembers(
  organizationId: string,
  currentUserId: string,
  client?: DatabaseClient,
): Promise<OrganizationMember[]> {
  const rows = await withDb(
    (db) =>
      db
        .select(memberSelection)
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(eq(organizationMembers.organizationId, organizationId))
        .orderBy(...memberOrder),
    client,
  );
  return rows.map((row) => mapMember(row, currentUserId));
}

export async function findOrganizationMember(
  organizationId: string,
  userId: string,
  currentUserId: string,
  client?: DatabaseClient,
): Promise<OrganizationMember | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(memberSelection)
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
        .limit(1),
    client,
  );
  return rows[0] ? mapMember(rows[0], currentUserId) : null;
}

/**
 * Owner ids, with the rows locked for the rest of the transaction.
 *
 * The last-owner rule is a read-then-write, so two admins demoting the two
 * remaining owners at the same time would each read `ownerCount = 2` and both
 * succeed. `FOR UPDATE` serialises them. It returns ids rather than a count
 * because PostgreSQL rejects `FOR UPDATE` alongside an aggregate.
 */
export async function lockOrganizationOwnerIds(organizationId: string, client: DatabaseClient): Promise<string[]> {
  const rows = await withDb(
    (db) =>
      db
        .select({ userId: organizationMembers.userId })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.role, "owner")))
        .for("update"),
    client,
  );
  return rows.map((row) => row.userId);
}

export async function updateOrganizationMemberRole(
  organizationId: string,
  userId: string,
  role: MemberRole,
  client: DatabaseClient,
): Promise<boolean> {
  const rows = await withDb(
    (db) =>
      db
        .update(organizationMembers)
        .set({ role })
        .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
        .returning({ userId: organizationMembers.userId }),
    client,
  );
  return rows.length > 0;
}

export async function deleteOrganizationMember(
  organizationId: string,
  userId: string,
  client: DatabaseClient,
): Promise<boolean> {
  const rows = await withDb(
    (db) =>
      db
        .delete(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
        .returning({ userId: organizationMembers.userId }),
    client,
  );
  return rows.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Invitations                                                                 */
/* -------------------------------------------------------------------------- */

interface InvitationRow {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: Date;
  createdAt: Date;
  invitedByName: string | null;
}

/**
 * `token_hash` is absent on purpose, the way it is for sessions: nothing that
 * reads an invitation for display has any use for the value that authorises it.
 */
const invitationSelection = {
  id: organizationInvitations.id,
  email: organizationInvitations.email,
  role: organizationInvitations.role,
  expiresAt: organizationInvitations.expiresAt,
  createdAt: organizationInvitations.createdAt,
  invitedByName: users.name,
};

/** Accepted and revoked invitations are history, not state. */
const invitationIsOpen = and(isNull(organizationInvitations.acceptedAt), isNull(organizationInvitations.revokedAt));

/**
 * Expiry is a comparison against now(), never a stored status, so a row cannot
 * sit in the database claiming to be pending after its deadline. Both read
 * models resolve it here, on the server, which also keeps the invitation page
 * from comparing dates while it renders.
 */
function invitationStatus(expiresAt: Date): InvitationStatus {
  return expiresAt.getTime() <= Date.now() ? "expired" : "pending";
}

function mapInvitation(row: InvitationRow): OrganizationInvitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: invitationStatus(row.expiresAt),
    invitedByName: row.invitedByName,
    createdAt: toIsoRequired(row.createdAt),
    expiresAt: toIsoRequired(row.expiresAt),
  };
}

/** Everything still open. */
export async function listOrganizationInvitations(
  organizationId: string,
  client?: DatabaseClient,
): Promise<OrganizationInvitation[]> {
  const rows = await withDb(
    (db) =>
      db
        .select(invitationSelection)
        .from(organizationInvitations)
        .leftJoin(users, eq(users.id, organizationInvitations.invitedBy))
        .where(and(eq(organizationInvitations.organizationId, organizationId), invitationIsOpen))
        .orderBy(desc(organizationInvitations.createdAt)),
    client,
  );
  return rows.map(mapInvitation);
}

/** Is this address already a member? Checked before inviting, by email not id. */
export async function findOrganizationMemberIdByEmail(
  organizationId: string,
  email: string,
  client: DatabaseClient,
): Promise<string | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({ userId: organizationMembers.userId })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(and(eq(organizationMembers.organizationId, organizationId), eq(users.email, email)))
        .limit(1),
    client,
  );
  return rows[0]?.userId ?? null;
}

/**
 * An open invitation for one address.
 *
 * The partial unique index already forbids a second one, but a caught
 * constraint violation makes a poor error message; this turns it into the
 * explanation the person needs ("revoke the pending one first").
 */
export async function findOpenInvitationIdByEmail(
  organizationId: string,
  email: string,
  client: DatabaseClient,
): Promise<string | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({ id: organizationInvitations.id })
        .from(organizationInvitations)
        .where(
          and(
            eq(organizationInvitations.organizationId, organizationId),
            eq(organizationInvitations.email, email),
            invitationIsOpen,
          ),
        )
        .limit(1),
    client,
  );
  return rows[0]?.id ?? null;
}

export async function insertOrganizationInvitation(
  input: {
    organizationId: string;
    email: string;
    role: MemberRole;
    tokenHash: string;
    invitedBy: string;
    expiresAt: Date;
  },
  client: DatabaseClient,
): Promise<OrganizationInvitation> {
  const inserted = await withDb(
    (db) =>
      db
        .insert(organizationInvitations)
        .values({
          organizationId: input.organizationId,
          email: input.email,
          role: input.role,
          tokenHash: input.tokenHash,
          invitedBy: input.invitedBy,
          expiresAt: input.expiresAt,
        })
        .returning({ id: organizationInvitations.id }),
    client,
  );
  const id = inserted[0]?.id;
  if (!id) throw new Error("Failed to create invitation");

  // Read back through the same join the list uses, on the caller's connection,
  // so the returned row carries the inviter name the display model expects.
  const rows = await withDb(
    (db) =>
      db
        .select(invitationSelection)
        .from(organizationInvitations)
        .leftJoin(users, eq(users.id, organizationInvitations.invitedBy))
        .where(and(eq(organizationInvitations.organizationId, input.organizationId), eq(organizationInvitations.id, id)))
        .limit(1),
    client,
  );
  const row = rows[0];
  if (!row) throw new Error("Invitation vanished after insert");
  return mapInvitation(row);
}

/**
 * Locks one open invitation for the rest of the transaction.
 *
 * Acceptance is a read-then-write over two tables, so two clicks on the same
 * link must not both pass the "still open" check. `FOR UPDATE` on the
 * invitation row is what serialises them; the second one finds `accepted_at`
 * already set.
 */
export async function lockOpenInvitationByTokenHash(
  tokenHash: string,
  client: DatabaseClient,
): Promise<{
  id: string;
  organizationId: string;
  email: string;
  role: MemberRole;
  expiresAt: Date;
} | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          id: organizationInvitations.id,
          organizationId: organizationInvitations.organizationId,
          email: organizationInvitations.email,
          role: organizationInvitations.role,
          expiresAt: organizationInvitations.expiresAt,
        })
        .from(organizationInvitations)
        .where(and(eq(organizationInvitations.tokenHash, tokenHash), invitationIsOpen))
        .for("update"),
    client,
  );
  return rows[0] ?? null;
}

/** The invitee-facing read model: an organization name and nothing else about it. */
export async function findInvitationPreviewByTokenHash(tokenHash: string): Promise<InvitationPreview | null> {
  const rows = await withDb((db) =>
    db
      .select({
        email: organizationInvitations.email,
        role: organizationInvitations.role,
        expiresAt: organizationInvitations.expiresAt,
        organizationName: organizations.name,
        invitedByName: users.name,
      })
      .from(organizationInvitations)
      .innerJoin(organizations, eq(organizations.id, organizationInvitations.organizationId))
      .leftJoin(users, eq(users.id, organizationInvitations.invitedBy))
      .where(and(eq(organizationInvitations.tokenHash, tokenHash), invitationIsOpen))
      .limit(1),
  );
  const row = rows[0];
  return row
    ? {
        organizationName: row.organizationName,
        email: row.email,
        role: row.role,
        status: invitationStatus(row.expiresAt),
        invitedByName: row.invitedByName,
        expiresAt: toIsoRequired(row.expiresAt),
      }
    : null;
}

export async function markInvitationAccepted(invitationId: string, userId: string, client: DatabaseClient): Promise<void> {
  // `now()` rather than a JavaScript clock: acceptance is stamped with the
  // transaction's own time, as it was before.
  await withDb(
    (db) =>
      db
        .update(organizationInvitations)
        .set({ acceptedAt: sql`now()`, acceptedBy: userId })
        .where(eq(organizationInvitations.id, invitationId)),
    client,
  );
}

/**
 * Revokes one open invitation, scoped to the organization the caller was
 * authorized for: an id from a URL never selects a row on its own.
 */
export async function revokeOrganizationInvitation(
  organizationId: string,
  invitationId: string,
  client: DatabaseClient,
): Promise<boolean> {
  const rows = await withDb(
    (db) =>
      db
        .update(organizationInvitations)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(organizationInvitations.id, invitationId),
            eq(organizationInvitations.organizationId, organizationId),
            invitationIsOpen,
          ),
        )
        .returning({ id: organizationInvitations.id }),
    client,
  );
  return rows.length > 0;
}

/** Membership row created on acceptance. Existing membership wins over the invitation. */
export async function insertOrganizationMember(
  organizationId: string,
  userId: string,
  role: MemberRole,
  client: DatabaseClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .insert(organizationMembers)
        .values({ organizationId, userId, role })
        .onConflictDoNothing({ target: [organizationMembers.organizationId, organizationMembers.userId] }),
    client,
  );
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

interface SessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

/**
 * `token_hash` is not in this list and must never be: the hash is the only
 * server-side secret that identifies a session, and a list endpoint has no use
 * for it.
 */
const sessionSelection = {
  id: sessions.id,
  userAgent: sessions.userAgent,
  ipAddress: sessions.ipAddress,
  createdAt: sessions.createdAt,
  lastSeenAt: sessions.lastSeenAt,
  expiresAt: sessions.expiresAt,
};

function mapSession(row: SessionRow, currentSessionId: string): UserSessionSummary {
  const device = describeUserAgent(row.userAgent);
  return {
    id: row.id,
    deviceLabel: device.label,
    browser: device.browser,
    operatingSystem: device.operatingSystem,
    userAgent: truncateUserAgent(row.userAgent),
    ipAddress: row.ipAddress,
    createdAt: toIsoRequired(row.createdAt),
    lastSeenAt: toIsoRequired(row.lastSeenAt),
    expiresAt: toIsoRequired(row.expiresAt),
    isCurrent: row.id === currentSessionId,
  };
}

/** Live sessions for one user, most recently active first. Expired rows are skipped. */
export async function listUserSessions(userId: string, currentSessionId: string): Promise<UserSessionSummary[]> {
  const rows = await withDb((db) =>
    db
      .select(sessionSelection)
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, sql`now()`)))
      .orderBy(desc(sessions.lastSeenAt), desc(sessions.createdAt)),
  );
  return rows.map((row) => mapSession(row, currentSessionId));
}

/** Ownership check before a revoke: a session id alone must never be enough. */
export async function findUserSessionId(userId: string, sessionId: string): Promise<string | null> {
  const rows = await withDb((db) =>
    db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId)))
      .limit(1),
  );
  return rows[0]?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

interface UserRow {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

const profileSelection = { id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl };

function mapProfile(row: UserRow): UserProfile {
  return { id: row.id, name: row.name, email: row.email, avatarUrl: row.avatarUrl };
}

export async function findUserProfile(userId: string): Promise<UserProfile | null> {
  const rows = await withDb((db) => db.select(profileSelection).from(users).where(eq(users.id, userId)).limit(1));
  return rows[0] ? mapProfile(rows[0]) : null;
}

/** Email is not updatable here: it is the login identity, changed through auth. */
export async function updateUserProfile(
  userId: string,
  input: { name: string; avatarUrl: string | null },
): Promise<UserProfile | null> {
  const rows = await withDb((db) =>
    db.update(users).set({ name: input.name, avatarUrl: input.avatarUrl }).where(eq(users.id, userId)).returning(profileSelection),
  );
  return rows[0] ? mapProfile(rows[0]) : null;
}

/* -------------------------------------------------------------------------- */
/* Usage                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Metered usage for one workspace over the last `days` days, one row per
 * `kind`. `quantity` is `bigint` and its sum comes back as a numeric string,
 * so the widening through `Number` happens exactly once, here.
 *
 * The window bound stays a SQL interval expression: `now() - (n * interval '1
 * day')` is computed by PostgreSQL against the same clock the rows were
 * stamped with, which a JavaScript-side date would not be.
 */
export async function sumUsageByKind(workspaceId: string, days: number): Promise<UsageKindTotal[]> {
  const rows = await withDb((db) =>
    db
      .select({
        kind: usageEvents.kind,
        total: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)`.mapWith(Number),
        events: sql<number>`count(*)`.mapWith(Number),
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.workspaceId, workspaceId),
          gte(usageEvents.occurredAt, sql`now() - (${days}::int * interval '1 day')`),
        ),
      )
      .groupBy(usageEvents.kind)
      .orderBy(asc(usageEvents.kind)),
  );
  return rows.map((row) => ({ kind: row.kind, total: row.total, events: row.events }));
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What one category costs this workspace.
 *
 * `pg_column_size(t.*)` is the size of the whole row as a value, which is the
 * number a person can act on: it counts every column, including the embedding
 * arrays that dominate `knowledge_chunks`. It is NOT the size on disk. Large
 * text is compressed and moved out of line by TOAST, and no index is counted
 * here, so the real table is usually smaller and the real database larger. The
 * page says so rather than implying an exact figure.
 *
 * `bigint` sums come back as numeric strings, so the widening through `Number`
 * happens exactly once, here.
 */
async function sumRowBytes(
  table: PgTable,
  workspaceColumn: AnyPgColumn,
  workspaceId: string,
): Promise<{ bytes: number; rows: number }> {
  const [row] = await withDb((db) =>
    db
      .select({
        bytes: sql<number>`coalesce(sum(pg_column_size(${table})), 0)`.mapWith(Number),
        rows: sql<number>`count(*)`.mapWith(Number),
      })
      .from(table)
      .where(eq(workspaceColumn, workspaceId)),
  );
  return { bytes: row?.bytes ?? 0, rows: row?.rows ?? 0 };
}

/**
 * Every storage category for one workspace.
 *
 * The categories are queried in parallel because they are independent reads on
 * the pool, and each is a plain aggregate filtered on `workspace_id` - the same
 * explicit boundary every other function in this file relies on, in addition to
 * the RLS policy on each table.
 */
export async function sumStorageByCategory(workspaceId: string): Promise<StorageCategoryTotal[]> {
  const sources: Record<StorageCategory, [PgTable, AnyPgColumn]> = {
    knowledgeChunks: [knowledgeChunks, knowledgeChunks.workspaceId],
    knowledgeSources: [knowledgeSources, knowledgeSources.workspaceId],
    conversations: [messages, messages.workspaceId],
    crmNotes: [contactNotes, contactNotes.workspaceId],
    activityLog: [activityLog, activityLog.workspaceId],
  };

  return Promise.all(
    STORAGE_CATEGORIES.map(async (category) => {
      const [table, column] = sources[category];
      const { bytes, rows } = await sumRowBytes(table, column, workspaceId);
      return { category, bytes, rows };
    }),
  );
}
