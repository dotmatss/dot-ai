import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { citext } from "@/server/db/schema/columns";
import { users } from "@/server/db/schema/identity";

/**
 * The platform control plane.
 *
 * Note the neighbouring `platform.ts` describes CUSTOMER infrastructure
 * (integrations, api keys, usage, activity) despite its name. These tables are
 * the operator's own, and none of them carries a `workspace_id`: they are
 * global, like `users` and `organizations`, and are therefore not covered by
 * the `*_workspace_isolation` policies. Authorization for them lives in
 * `requirePlatformAdmin()`, not in Row Level Security.
 *
 * See `src/server/db/migrations/0023_platform_control_plane.sql`, which owns
 * the definitions this file merely describes.
 */

/**
 * Who may operate the platform.
 *
 * Deliberately keyed on `user_id` alone: a user either holds the platform
 * boundary or does not, and there is no second platform role to disambiguate.
 * A support role, if the product ever needs one (see docs/security.md), is an
 * additive column here rather than a second table.
 */
export const platformAdmins = pgTable(
  "platform_admins",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    /** Soft revocation, so a withdrawn grant stays answerable. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    note: text("note"),
  },
  // Partial indexes are not expressible here; the live definition carries the
  // `WHERE revoked_at IS NULL` clause. Drizzle sees only the column list.
  (table) => [index("platform_admins_active_idx").on(table.userId)],
);

/**
 * Append-only record of privileged platform actions.
 *
 * Separate from `activity_log` because that table is workspace-scoped
 * (`workspace_id NOT NULL ... ON DELETE CASCADE`): a platform action has no
 * workspace, and a tenant deletion would cascade the operator's trail away.
 */
export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** Denormalized: `actor_id` nulls out when an operator account is deleted. */
    actorEmail: citext("actor_email"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    /** Text, not uuid: flags and settings keys are addressed by name. */
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    result: text("result").notNull().default("success"),
    /** Never a credential. `redactMetadata()` in the service is the only writer. */
    metadata: jsonb("metadata").notNull().default({}),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("platform_audit_log_created_idx").on(table.createdAt.desc()),
    index("platform_audit_log_actor_idx").on(table.actorId, table.createdAt.desc()),
    index("platform_audit_log_action_idx").on(table.action, table.createdAt.desc()),
    index("platform_audit_log_target_idx").on(table.targetType, table.targetId),
  ],
);
