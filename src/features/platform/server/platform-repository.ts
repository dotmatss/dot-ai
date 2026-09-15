import "server-only";

import { and, asc, count, desc, eq, gt, gte, ilike, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";

import type {
  PlatformAuditEntry,
  PlatformAuditFilters,
  PlatformOrganizationDetail,
  PlatformOrganizationFilters,
  PlatformOrganizationSummary,
  PlatformUserDetail,
  PlatformUserFilters,
  PlatformUserSummary,
} from "@/features/platform/types";
import { withDb, type DatabaseClient } from "@/server/db/client";
import {
  agents,
  chatbots,
  knowledgeCollections,
  organizationMembers,
  organizations,
  platformAdmins,
  platformAuditLog,
  sessions,
  usageEvents,
  users,
  workflows,
  workspaces,
} from "@/server/db/schema";
import { likePattern, normalizePage, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

/** Connection-less builder, used only to COMPOSE correlated subqueries. */
const qb = new QueryBuilder();

/**
 * Reads for the platform control plane. These are the CROSS-TENANT queries.
 *
 * ── Why this is not a hole in tenant isolation ──────────────────────────────
 *
 * Nothing here weakens Row Level Security, and nothing here needs to. The
 * `*_workspace_isolation` policies are written to pass when `app.workspace_id`
 * is unset (migration 0014), which is what already lets migrations, the seed
 * script and the health probe work. Statements below simply run outside
 * `withWorkspace()`, exactly as those do - they do not disable, bypass or
 * re-grant anything.
 *
 * What keeps that from being a bypass is WHERE it is allowed to happen:
 *
 *   - Every caller of this module goes through `requirePlatformAccess` or
 *     `platformRoute`, which resolve `platform_admins` and nothing else.
 *   - `tests/unit/platform-isolation.test.ts` walks the import graph and fails
 *     if anything outside the platform plane reaches this file, so a customer
 *     route cannot acquire cross-tenant reads by importing a convenient helper.
 *
 * ── What these queries deliberately never select ────────────────────────────
 *
 * No password hash, no session token hash, no sealed credential, no API key
 * digest, no message body, no knowledge chunk, no CRM note. The operator plane
 * manages tenants and platform configuration; it is not a window into customer
 * content. Selecting columns by name through the schema keeps that property
 * checkable, and `tests/unit/platform-isolation.test.ts` greps this file for
 * those column names so widening it is a visible decision rather than a quiet
 * one.
 *
 * ── Performance ─────────────────────────────────────────────────────────────
 *
 * Every list is paginated and every per-row count is a correlated aggregate in
 * one statement, never a query per row.
 *
 * ── Search patterns ─────────────────────────────────────────────────────────
 *
 * `likePattern()` escapes user wildcards with a backslash, which is already
 * PostgreSQL's default LIKE escape character, so the explicit `ESCAPE '\'` the
 * hand-written SQL carried was a restatement of the default and is not needed
 * by the builder.
 */

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  status: PlatformOrganizationSummary["status"];
  statusReason: string | null;
  statusChangedAt: Date | null;
  createdAt: Date;
  workspaceCount: number;
  memberCount: number;
}

/**
 * The two counts are scalar subqueries rather than joins: joining `workspaces`
 * and `organization_members` in one statement multiplies the rows and makes
 * both counts wrong, which is the classic way a table like this ends up lying.
 *
 * They are COMPOSED with the query builder rather than written as `sql`
 * templates. That is load-bearing: in a select list with no join, Drizzle
 * renders an interpolated column without its table name, so a template would
 * emit `WHERE "organization_id" = "id"` - both columns of the INNER table,
 * which is a count of the wrong thing and looks perfectly plausible.
 */
const organizationSelection = {
  id: organizations.id,
  name: organizations.name,
  slug: organizations.slug,
  status: organizations.status,
  statusReason: organizations.statusReason,
  statusChangedAt: organizations.statusChangedAt,
  createdAt: organizations.createdAt,
  workspaceCount: sql<number>`${qb
    .select({ c: sql`count(*)` })
    .from(workspaces)
    .where(eq(workspaces.organizationId, organizations.id))}`.mapWith(Number),
  memberCount: sql<number>`${qb
    .select({ c: sql`count(*)` })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizations.id))}`.mapWith(Number),
};

function mapOrganization(row: OrganizationRow): PlatformOrganizationSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    statusReason: row.statusReason,
    statusChangedAt: toIso(row.statusChangedAt),
    createdAt: toIsoRequired(row.createdAt),
    workspaceCount: row.workspaceCount,
    memberCount: row.memberCount,
  };
}

function organizationWhere(filters: PlatformOrganizationFilters): SQL | undefined {
  const clauses: Array<SQL | undefined> = [];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    clauses.push(or(ilike(organizations.name, pattern), ilike(organizations.slug, pattern)));
  }
  if (filters.status) clauses.push(eq(organizations.status, filters.status));
  return clauses.length > 0 ? and(...clauses) : undefined;
}

export async function listOrganizations(filters: PlatformOrganizationFilters): Promise<Paginated<PlatformOrganizationSummary>> {
  const page = normalizePage(filters);
  const where = organizationWhere(filters);

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db
        .select(organizationSelection)
        .from(organizations)
        .where(where)
        .orderBy(desc(organizations.createdAt), asc(organizations.id))
        .limit(page.pageSize)
        .offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(organizations).where(where)),
  ]);

  return toPaginated(rows.map(mapOrganization), totals[0]?.total ?? 0, page);
}

export async function getOrganizationDetail(organizationId: string): Promise<PlatformOrganizationDetail | null> {
  const baseRows = await withDb((db) =>
    db.select(organizationSelection).from(organizations).where(eq(organizations.id, organizationId)).limit(1),
  );
  const base = baseRows[0];
  if (!base) return null;

  const [workspaceRows, memberRows, usageRows] = await Promise.all([
    withDb((db) =>
      db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          slug: workspaces.slug,
          createdAt: workspaces.createdAt,
          chatbots: sql<number>`${qb
            .select({ c: sql`count(*)` })
            .from(chatbots)
            .where(eq(chatbots.workspaceId, workspaces.id))}`.mapWith(Number),
          agents: sql<number>`${qb
            .select({ c: sql`count(*)` })
            .from(agents)
            .where(eq(agents.workspaceId, workspaces.id))}`.mapWith(Number),
          workflows: sql<number>`${qb
            .select({ c: sql`count(*)` })
            .from(workflows)
            .where(eq(workflows.workspaceId, workspaces.id))}`.mapWith(Number),
          collections: sql<number>`${qb
            .select({ c: sql`count(*)` })
            .from(knowledgeCollections)
            .where(eq(knowledgeCollections.workspaceId, workspaces.id))}`.mapWith(Number),
        })
        .from(workspaces)
        .where(eq(workspaces.organizationId, organizationId))
        .orderBy(asc(workspaces.createdAt), asc(workspaces.id)),
    ),
    withDb((db) =>
      db
        .select({
          userId: organizationMembers.userId,
          name: users.name,
          email: users.email,
          role: organizationMembers.role,
          disabledAt: users.disabledAt,
          joinedAt: organizationMembers.createdAt,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(eq(organizationMembers.organizationId, organizationId))
        .orderBy(asc(organizationMembers.createdAt), asc(organizationMembers.userId)),
    ),
    // One pass over the organization's usage rather than one query per metric.
    // The four totals are `FILTER`ed aggregates, which is the PostgreSQL
    // construct that makes that single pass possible; the join, the tenant
    // predicate and the window bound stay in the builder.
    withDb((db) =>
      db
        .select({
          messages: sql<number>`coalesce(sum(${usageEvents.quantity}) FILTER (WHERE ${usageEvents.kind} = 'message'), 0)`.mapWith(Number),
          tokensIn: sql<number>`coalesce(sum(${usageEvents.quantity}) FILTER (WHERE ${usageEvents.kind} = 'tokens_in'), 0)`.mapWith(Number),
          tokensOut:
            sql<number>`coalesce(sum(${usageEvents.quantity}) FILTER (WHERE ${usageEvents.kind} = 'tokens_out'), 0)`.mapWith(Number),
          workflowRuns:
            sql<number>`coalesce(sum(${usageEvents.quantity}) FILTER (WHERE ${usageEvents.kind} = 'workflow_run'), 0)`.mapWith(Number),
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(workspaces.id, usageEvents.workspaceId))
        .where(
          and(
            eq(workspaces.organizationId, organizationId),
            gte(usageEvents.occurredAt, sql`now() - interval '30 days'`),
          ),
        ),
    ),
  ]);

  const usage = usageRows[0];
  return {
    ...mapOrganization(base),
    workspaces: workspaceRows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: toIsoRequired(row.createdAt),
      chatbots: row.chatbots,
      agents: row.agents,
      workflows: row.workflows,
      collections: row.collections,
    })),
    members: memberRows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      role: row.role,
      disabledAt: toIso(row.disabledAt),
      joinedAt: toIsoRequired(row.joinedAt),
    })),
    usageLast30Days: {
      messages: Number(usage?.messages ?? 0),
      tokensIn: Number(usage?.tokensIn ?? 0),
      tokensOut: Number(usage?.tokensOut ?? 0),
      workflowRuns: Number(usage?.workflowRuns ?? 0),
    },
  };
}

/**
 * Read before a status write, so the audit row can name the target and the
 * state it moved from.
 *
 * `FOR UPDATE` because the caller then decides whether to write based on what
 * this returned. Without the lock, two operators suspending the same tenant at
 * once would both read `active`, both pass the "already suspended" check, and
 * both write - producing two audit rows for one real transition. The lock is
 * only meaningful when a transaction client is passed, which is how
 * `changeOrganizationStatus` calls it.
 */
export async function findOrganizationIdentity(
  organizationId: string,
  client?: DatabaseClient,
): Promise<{ name: string; slug: string; status: string } | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({ name: organizations.name, slug: organizations.slug, status: organizations.status })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .for("update"),
    client,
  );
  return rows[0] ?? null;
}

export async function updateOrganizationStatus(
  organizationId: string,
  status: string,
  reason: string | null,
  client?: DatabaseClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(organizations)
        .set({
          status: status as PlatformOrganizationSummary["status"],
          statusReason: reason,
          // The transaction's own clock, as the hand-written statement used.
          statusChangedAt: sql`now()`,
        })
        .where(eq(organizations.id, organizationId)),
    client,
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  disabledAt: Date | null;
  disabledReason: string | null;
  isPlatformAdmin: boolean;
  organizationCount: number;
  lastSeenAt: Date | null;
}

/**
 * Shared projection.
 *
 * `lastSeenAt` is the newest LIVE session's heartbeat, so an expired session
 * does not read as recent activity. No token, user agent or IP address is
 * selected with it, and no credential column appears anywhere in this module.
 */
const userSelection = {
  id: users.id,
  email: users.email,
  name: users.name,
  createdAt: users.createdAt,
  disabledAt: users.disabledAt,
  disabledReason: users.disabledReason,
  isPlatformAdmin: sql<boolean>`EXISTS ${qb
    .select({ one: sql`1` })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.userId, users.id), isNull(platformAdmins.revokedAt)))}`,
  organizationCount: sql<number>`${qb
    .select({ c: sql`count(*)` })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, users.id))}`.mapWith(Number),
  lastSeenAt: sql<Date | null>`${qb
    .select({ seen: sql`max(${sessions.lastSeenAt})` })
    .from(sessions)
    .where(and(eq(sessions.userId, users.id), gt(sessions.expiresAt, sql`now()`)))}`,
};

function mapUser(row: UserRow): PlatformUserSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: toIsoRequired(row.createdAt),
    disabledAt: toIso(row.disabledAt),
    disabledReason: row.disabledReason,
    isPlatformAdmin: row.isPlatformAdmin,
    organizationCount: row.organizationCount,
    lastSeenAt: toIso(row.lastSeenAt),
  };
}

function userWhere(filters: PlatformUserFilters): SQL | undefined {
  const clauses: Array<SQL | undefined> = [];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    clauses.push(or(ilike(users.name, pattern), ilike(users.email, pattern)));
  }
  if (filters.state === "disabled") clauses.push(isNotNull(users.disabledAt));
  if (filters.state === "active") clauses.push(isNull(users.disabledAt));
  return clauses.length > 0 ? and(...clauses) : undefined;
}

export async function listUsers(filters: PlatformUserFilters): Promise<Paginated<PlatformUserSummary>> {
  const page = normalizePage(filters);
  const where = userWhere(filters);

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db
        .select(userSelection)
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt), asc(users.id))
        .limit(page.pageSize)
        .offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(users).where(where)),
  ]);

  return toPaginated(rows.map(mapUser), totals[0]?.total ?? 0, page);
}

export async function getUserDetail(userId: string): Promise<PlatformUserDetail | null> {
  const baseRows = await withDb((db) => db.select(userSelection).from(users).where(eq(users.id, userId)).limit(1));
  const base = baseRows[0];
  if (!base) return null;

  const [membershipRows, sessionTotals] = await Promise.all([
    withDb((db) =>
      db
        .select({
          organizationId: organizations.id,
          organizationName: organizations.name,
          organizationSlug: organizations.slug,
          organizationStatus: organizations.status,
          role: organizationMembers.role,
          joinedAt: organizationMembers.createdAt,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(eq(organizationMembers.userId, userId))
        .orderBy(asc(organizationMembers.createdAt), asc(organizations.id)),
    ),
    withDb((db) =>
      db
        .select({ total: count() })
        .from(sessions)
        .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, sql`now()`))),
    ),
  ]);

  return {
    ...mapUser(base),
    memberships: membershipRows.map((row) => ({
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      organizationSlug: row.organizationSlug,
      organizationStatus: row.organizationStatus,
      role: row.role,
      joinedAt: toIsoRequired(row.joinedAt),
    })),
    activeSessions: sessionTotals[0]?.total ?? 0,
  };
}

/** Locked for the same reason as `findOrganizationIdentity` above. */
export async function findUserIdentity(
  userId: string,
  client?: DatabaseClient,
): Promise<{ email: string; name: string; disabledAt: Date | null } | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({ email: users.email, name: users.name, disabledAt: users.disabledAt })
        .from(users)
        .where(eq(users.id, userId))
        .for("update"),
    client,
  );
  return rows[0] ?? null;
}

export async function setUserDisabled(
  userId: string,
  disabled: boolean,
  reason: string | null,
  client?: DatabaseClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(users)
        // `now()` when disabling, NULL when re-enabling - the two arms the
        // hand-written CASE expressed, resolved here because `disabled` is
        // already known before the statement is built.
        .set({ disabledAt: disabled ? sql`now()` : null, disabledReason: reason })
        .where(eq(users.id, userId)),
    client,
  );
}

/**
 * Ends every live session for an account.
 *
 * Disabling that left existing sessions alive would take effect whenever the
 * cookie happened to expire, which is not a control. Deleting the rows makes it
 * take effect on the account's next request.
 */
export async function deleteUserSessions(userId: string, client?: DatabaseClient): Promise<number> {
  const rows = await withDb(
    (db) => db.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id }),
    client,
  );
  return rows.length;
}

// ---------------------------------------------------------------------------
// Platform audit log
// ---------------------------------------------------------------------------

const auditSelection = {
  id: platformAuditLog.id,
  actorId: platformAuditLog.actorId,
  actorName: users.name,
  actorEmail: platformAuditLog.actorEmail,
  action: platformAuditLog.action,
  targetType: platformAuditLog.targetType,
  targetId: platformAuditLog.targetId,
  targetLabel: platformAuditLog.targetLabel,
  result: platformAuditLog.result,
  metadata: platformAuditLog.metadata,
  createdAt: platformAuditLog.createdAt,
};

function auditWhere(filters: PlatformAuditFilters): SQL | undefined {
  const clauses: Array<SQL | undefined> = [];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    clauses.push(
      or(
        ilike(platformAuditLog.targetLabel, pattern),
        ilike(platformAuditLog.action, pattern),
        ilike(platformAuditLog.actorEmail, pattern),
      ),
    );
  }
  if (filters.action) clauses.push(eq(platformAuditLog.action, filters.action));
  if (filters.result) clauses.push(eq(platformAuditLog.result, filters.result));
  // The bounds stay `::date` casts so the day is resolved by PostgreSQL in the
  // server's own time zone, exactly as before, rather than by a JavaScript date.
  if (filters.from) clauses.push(gte(platformAuditLog.createdAt, sql`${filters.from}::date`));
  // Inclusive upper bound: `<= '2026-09-13'` would drop everything after midnight.
  if (filters.to) clauses.push(lt(platformAuditLog.createdAt, sql`(${filters.to}::date + interval '1 day')`));
  return clauses.length > 0 ? and(...clauses) : undefined;
}

export async function listPlatformAudit(filters: PlatformAuditFilters): Promise<Paginated<PlatformAuditEntry>> {
  const page = normalizePage(filters);
  const where = auditWhere(filters);

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db
        .select(auditSelection)
        .from(platformAuditLog)
        .leftJoin(users, eq(users.id, platformAuditLog.actorId))
        .where(where)
        .orderBy(desc(platformAuditLog.createdAt), desc(platformAuditLog.id))
        .limit(page.pageSize)
        .offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(platformAuditLog).where(where)),
  ]);

  return toPaginated(
    rows.map((row) => ({
      id: String(row.id),
      actorId: row.actorId,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      targetLabel: row.targetLabel,
      // `result` is a plain text column, narrowed to the three values the
      // service writes. This is the same assertion the hand-written row type made.
      result: row.result as PlatformAuditEntry["result"],
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      createdAt: toIsoRequired(row.createdAt),
    })),
    totals[0]?.total ?? 0,
    page,
  );
}

/** Distinct actions actually present, so the filter offers only choices that return rows. */
export async function listPlatformAuditActions(): Promise<string[]> {
  const rows = await withDb((db) =>
    db.selectDistinct({ action: platformAuditLog.action }).from(platformAuditLog).orderBy(asc(platformAuditLog.action)),
  );
  return rows.map((row) => row.action);
}
