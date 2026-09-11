import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { workflowRunStatus, workflowStatus } from "@/server/db/schema/columns";
import { users } from "@/server/db/schema/identity";
import { workspaces } from "@/server/db/schema/tenancy";

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: workflowStatus("status").notNull().default("draft"),
    definition: jsonb("definition").notNull().default({ nodes: [], edges: [] }),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("workflows_workspace_id_idx").on(table.workspaceId, table.updatedAt.desc())],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    status: workflowRunStatus("status").notNull().default("queued"),
    trigger: jsonb("trigger").notNull().default({}),
    input: jsonb("input"),
    output: jsonb("output"),
    steps: jsonb("steps").notNull().default([]),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("workflow_runs_workflow_idx").on(table.workflowId, table.createdAt.desc()),
    index("workflow_runs_workspace_idx").on(table.workspaceId, table.createdAt.desc()),
  ],
);
