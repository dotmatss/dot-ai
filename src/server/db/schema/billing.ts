import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { subscriptionStatus } from "@/server/db/schema/columns";
import { users } from "@/server/db/schema/identity";
import { workspaces } from "@/server/db/schema/tenancy";

/**
 * The plan assignment (migration 0028).
 *
 * Describes what the database already holds; the migration owns the reasoning,
 * including why there is no backfill and why `planId` is text rather than an
 * enum or a foreign key.
 *
 * Nothing here is money. There is no amount, no currency, no processor id and
 * no invoice, because none of those have been decided - see
 * `src/features/pricing/types.ts`, where `PlanPrice` has no `amount` field for
 * the same reason. This row says which plan a workspace was put on and over
 * what period its metered allowances are counted.
 */
export const workspaceSubscriptions = pgTable(
  "workspace_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** An id from `PLANS` in src/features/pricing/plans.ts. Validated on write. */
    planId: text("plan_id").notNull(),
    status: subscriptionStatus("status").notNull().default("active"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull().defaultNow(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("workspace_subscriptions_workspace_idx").on(table.workspaceId)],
);
