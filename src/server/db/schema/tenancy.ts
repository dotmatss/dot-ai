import { check, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { citext, memberRole, organizationStatus } from "@/server/db/schema/columns";
import { users } from "@/server/db/schema/identity";

/**
 * Tenancy. Membership is held at the ORGANIZATION level; a workspace inherits
 * the organization's members and their roles. There is no workspace_members
 * table, and `organization_members` has no workspace_id, so it is not covered
 * by Row Level Security - every query over it must filter by an organization
 * id resolved from an authorized workspace context.
 */

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /**
   * Lifecycle owned by the platform plane, not by the organization itself
   * (migration 0023). Defaults to 'active', so no existing tenant changed.
   */
  status: organizationStatus("status").notNull().default("active"),
  statusReason: text("status_reason"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index("organization_members_user_id_idx").on(table.userId),
  ],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("workspaces_organization_id_idx").on(table.organizationId)],
);

/**
 * Pending invitations into an organization.
 *
 * Only the SHA-256 of the link token is stored (`sessions` does the same), and
 * the three terminal states are timestamps rather than a status column so each
 * one records when it happened. Like `organization_members`, this table has no
 * `workspace_id` and therefore no Row Level Security; the settings service is
 * what keeps every query pinned to an authorized organization id.
 */
export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: citext("email").notNull(),
    role: memberRole("role").notNull().default("member"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("organization_invitations_pending_email_idx")
      .on(table.organizationId, table.email)
      .where(sql`accepted_at IS NULL AND revoked_at IS NULL`),
    index("organization_invitations_organization_idx").on(table.organizationId, table.createdAt.desc()),
    check(
      "organization_invitations_accepted_by_present",
      sql`(accepted_at IS NULL) = (accepted_by IS NULL)`,
    ),
  ],
);
