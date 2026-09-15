import "server-only";

import { and, asc, count, desc, eq, gte, ilike, lt, or } from "drizzle-orm";
import type { PoolClient } from "pg";

import type { AuditEntry, AuditFacets, AuditListFilters } from "@/features/audit/types";
import { withDb } from "@/server/db/client";
import { activityLog, users } from "@/server/db/schema";
import { likePattern, normalizePage, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

const auditSelection = {
  id: activityLog.id,
  actorId: activityLog.actorId,
  actorName: users.name,
  entityType: activityLog.entityType,
  entityId: activityLog.entityId,
  action: activityLog.action,
  summary: activityLog.summary,
  createdAt: activityLog.createdAt,
};

type AuditRow = typeof auditSelection extends infer _T ? {
  id: bigint;
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  summary: string;
  createdAt: Date;
} : never;

export function mapAuditRow(row: AuditRow): AuditEntry {
  return {
    id: String(row.id),
    actorId: row.actorId,
    actorName: row.actorName,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    summary: row.summary,
    createdAt: toIsoRequired(row.createdAt),
  };
}

function nextDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function buildWhere(workspaceId: string, filters: AuditListFilters) {
  const clauses = [eq(activityLog.workspaceId, workspaceId)];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    clauses.push(or(ilike(activityLog.summary, pattern), ilike(users.name, pattern))!);
  }
  if (filters.actorId) clauses.push(eq(activityLog.actorId, filters.actorId));
  if (filters.entityType) clauses.push(eq(activityLog.entityType, filters.entityType));
  if (filters.action) clauses.push(eq(activityLog.action, filters.action));
  if (filters.from) clauses.push(gte(activityLog.createdAt, new Date(`${filters.from}T00:00:00.000Z`)));
  if (filters.to) clauses.push(lt(activityLog.createdAt, nextDate(filters.to)));
  return and(...clauses);
}

export async function listAuditEntries(workspaceId: string, filters: AuditListFilters): Promise<Paginated<AuditEntry>> {
  const page = normalizePage(filters);
  const where = buildWhere(workspaceId, filters);
  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db
        .select(auditSelection)
        .from(activityLog)
        .leftJoin(users, eq(users.id, activityLog.actorId))
        .where(where)
        .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
        .limit(page.pageSize)
        .offset(page.offset),
    ),
    withDb((db) =>
      db
        .select({ total: count() })
        .from(activityLog)
        .leftJoin(users, eq(users.id, activityLog.actorId))
        .where(where),
    ),
  ]);
  return toPaginated(rows.map(mapAuditRow), totals[0]?.total ?? 0, page);
}

export async function listRecentAuditEntries(workspaceId: string, limit = 10, client?: PoolClient): Promise<AuditEntry[]> {
  const rows = await withDb(
    (db) =>
      db
        .select(auditSelection)
        .from(activityLog)
        .leftJoin(users, eq(users.id, activityLog.actorId))
        .where(eq(activityLog.workspaceId, workspaceId))
        .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
        .limit(limit),
    client,
  );
  return rows.map(mapAuditRow);
}

export async function listAuditFacets(workspaceId: string): Promise<AuditFacets> {
  const [entityTypes, actions, actors] = await Promise.all([
    withDb((db) =>
      db
        .selectDistinct({ value: activityLog.entityType })
        .from(activityLog)
        .where(eq(activityLog.workspaceId, workspaceId))
        .orderBy(asc(activityLog.entityType)),
    ),
    withDb((db) =>
      db
        .selectDistinct({ value: activityLog.action })
        .from(activityLog)
        .where(eq(activityLog.workspaceId, workspaceId))
        .orderBy(asc(activityLog.action)),
    ),
    withDb((db) =>
      db
        .selectDistinct({ id: users.id, name: users.name })
        .from(activityLog)
        .innerJoin(users, eq(users.id, activityLog.actorId))
        .where(eq(activityLog.workspaceId, workspaceId))
        .orderBy(asc(users.name)),
    ),
  ]);
  return {
    entityTypes: entityTypes.map((row) => row.value),
    actions: actions.map((row) => row.value),
    actors: actors.map((row) => ({ id: row.id, name: row.name })),
  };
}
