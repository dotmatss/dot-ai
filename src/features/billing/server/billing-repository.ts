import "server-only";

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { PoolClient } from "pg";

import type { SubscriptionStatus, WorkspaceSubscription } from "@/features/billing/types";
import { findPlan } from "@/features/pricing/plans";
import { withDb } from "@/server/db/client";
import { usageEvents, users, workspaceSubscriptions } from "@/server/db/schema";
import { toIsoRequired } from "@/server/db/sql";

/**
 * SQL for the plan assignment. Every statement filters on `workspace_id`
 * explicitly, in addition to the Row Level Security policy from migration 0028
 * - Drizzle is a typing layer, not an authorization layer.
 */

interface SubscriptionRow {
  id: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  assignedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Resolves the plan name from the catalogue rather than from the row.
 *
 * A stored `plan_id` that the catalogue no longer contains is reported as
 * unknown rather than thrown on: a plan renamed or removed in
 * `src/features/pricing/plans.ts` must not be able to take a workspace's
 * settings page down with it.
 */
function toSubscription(row: SubscriptionRow): WorkspaceSubscription {
  const plan = findPlan(row.planId);
  return {
    id: row.id,
    planId: row.planId,
    planName: plan?.name ?? null,
    planKnown: plan !== undefined,
    status: row.status,
    currentPeriodStart: toIsoRequired(row.currentPeriodStart),
    currentPeriodEnd: toIsoRequired(row.currentPeriodEnd),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    assignedByName: row.assignedByName,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

export async function findSubscription(workspaceId: string, client?: PoolClient): Promise<WorkspaceSubscription | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          id: workspaceSubscriptions.id,
          planId: workspaceSubscriptions.planId,
          status: workspaceSubscriptions.status,
          currentPeriodStart: workspaceSubscriptions.currentPeriodStart,
          currentPeriodEnd: workspaceSubscriptions.currentPeriodEnd,
          cancelAtPeriodEnd: workspaceSubscriptions.cancelAtPeriodEnd,
          assignedByName: users.name,
          createdAt: workspaceSubscriptions.createdAt,
          updatedAt: workspaceSubscriptions.updatedAt,
        })
        .from(workspaceSubscriptions)
        // Left join: the assigning user may since have been deleted, which sets
        // `assigned_by` to null. That must not hide the subscription.
        .leftJoin(users, eq(users.id, workspaceSubscriptions.assignedBy))
        .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
        .limit(1),
    client,
  );
  const row = rows.at(0);
  return row ? toSubscription(row) : null;
}

export interface UpsertSubscriptionInput {
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  assignedBy: string | null;
}

/**
 * Writes the assignment. One row per workspace, so a second assignment replaces
 * the first rather than accumulating history - `activity_log` is where the
 * history lives, and duplicating it here would give "which plan is this
 * workspace on" two answers.
 */
export async function upsertSubscription(
  workspaceId: string,
  input: UpsertSubscriptionInput,
  client?: PoolClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .insert(workspaceSubscriptions)
        .values({ workspaceId, ...input })
        .onConflictDoUpdate({
          target: workspaceSubscriptions.workspaceId,
          set: { ...input, updatedAt: new Date() },
        }),
    client,
  );
}

export async function deleteSubscription(workspaceId: string, client?: PoolClient): Promise<void> {
  await withDb(
    (db) => db.delete(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, workspaceId)),
    client,
  );
}

/**
 * Sums `usage_events.quantity` for a set of kinds over a half-open window.
 *
 * Half-open on purpose: `[start, end)` means consecutive periods cannot both
 * count an event stamped exactly on the boundary. `quantity` is `bigint` and
 * sums to a numeric string, so the widening through `Number` happens once,
 * here, exactly as `sumUsageByKind` does it in the settings repository.
 */
export async function sumUsageForKinds(
  workspaceId: string,
  kinds: ReadonlyArray<string>,
  periodStart: Date,
  periodEnd: Date,
  client?: PoolClient,
): Promise<number> {
  if (kinds.length === 0) return 0;
  const rows = await withDb(
    (db) =>
      db
        .select({ total: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)`.mapWith(Number) })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.workspaceId, workspaceId),
            inArray(usageEvents.kind, [...kinds]),
            gte(usageEvents.occurredAt, periodStart),
            lt(usageEvents.occurredAt, periodEnd),
          ),
        ),
    client,
  );
  return rows.at(0)?.total ?? 0;
}

/**
 * Every metered kind for the period in one pass, for the billing page.
 *
 * The page reports usage for all three metered keys whether or not a limit has
 * been decided, so asking per key would be three round trips to render one
 * table. `checkEntitlement` keeps using the targeted sum above: it answers for
 * a single key and must not pay for the other two.
 */
export async function sumUsageByKindInPeriod(
  workspaceId: string,
  periodStart: Date,
  periodEnd: Date,
  client?: PoolClient,
): Promise<Map<string, number>> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          kind: usageEvents.kind,
          total: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)`.mapWith(Number),
        })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.workspaceId, workspaceId),
            gte(usageEvents.occurredAt, periodStart),
            lt(usageEvents.occurredAt, periodEnd),
          ),
        )
        .groupBy(usageEvents.kind),
    client,
  );
  return new Map(rows.map((row) => [row.kind, row.total]));
}
