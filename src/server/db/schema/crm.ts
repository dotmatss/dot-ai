import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { citext, contactStage } from "@/server/db/schema/columns";
import { users } from "@/server/db/schema/identity";
import { workspaces } from "@/server/db/schema/tenancy";

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: citext("email"),
    name: text("name"),
    phone: text("phone"),
    company: text("company"),
    stage: contactStage("stage").notNull().default("lead"),
    source: text("source"),
    tags: text("tags").array().notNull().default([]),
    properties: jsonb("properties").notNull().default({}),
    aiSummary: text("ai_summary"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Partial: a workspace may hold many contacts with no email at all.
    uniqueIndex("contacts_workspace_email_key")
      .on(table.workspaceId, table.email)
      .where(sql`${table.email} IS NOT NULL`),
    index("contacts_workspace_id_idx").on(table.workspaceId, table.updatedAt.desc()),
    index("contacts_tags_idx").using("gin", table.tags),
    // `id` breaks ties: rows imported in one statement share created_at, and
    // without a tiebreaker a row can appear on two pages of the list, or none.
    index("contacts_workspace_created_idx").on(table.workspaceId, table.createdAt.desc(), table.id.desc()),
  ],
);

export const contactNotes = pgTable(
  "contact_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("contact_notes_contact_idx").on(table.contactId, table.createdAt.desc())],
);

export const contactActivities = pgTable(
  "contact_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    description: text("description").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("contact_activities_contact_idx").on(table.contactId, table.createdAt.desc())],
);
