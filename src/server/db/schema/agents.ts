import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { agents } from "@/server/db/schema/chatbots";
import { agentExecutionStatus } from "@/server/db/schema/columns";
import { conversations } from "@/server/db/schema/conversations";
import { workspaces } from "@/server/db/schema/tenancy";
import { workflowRuns } from "@/server/db/schema/workflows";

/**
 * Agent delegation and execution (migration 0021).
 *
 * The `agents` table itself lives in `chatbots.ts`, next to the chatbots that
 * deploy it. These two tables are everything the supervisor capability adds.
 */

/**
 * Which agents a supervisor may delegate to.
 *
 * Both foreign keys are composite and share one `workspace_id` column, so a
 * grant spanning two workspaces has no representable row shape - the check is
 * structural rather than a rule the application has to remember.
 */
export const agentDelegations = pgTable(
  "agent_delegations",
  {
    supervisorAgentId: uuid("supervisor_agent_id").notNull(),
    childAgentId: uuid("child_agent_id").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Revoked without being forgotten; refused at delegation time like a missing grant. */
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.supervisorAgentId, table.childAgentId] }),
    check("agent_delegations_no_self_delegation", sql`${table.supervisorAgentId} <> ${table.childAgentId}`),
    foreignKey({
      name: "agent_delegations_supervisor_fkey",
      columns: [table.supervisorAgentId, table.workspaceId],
      foreignColumns: [agents.id, agents.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "agent_delegations_child_fkey",
      columns: [table.childAgentId, table.workspaceId],
      foreignColumns: [agents.id, agents.workspaceId],
    }).onDelete("cascade"),
    index("agent_delegations_child_idx").on(table.childAgentId),
  ],
);

/**
 * One agent turn, and its place in a delegation tree.
 *
 * This is what depth, delegation count and token budget are enforced against,
 * and what makes a multi-agent request reconstructable afterwards. Child
 * executions never create conversations; the tree lives here and the single
 * user-facing conversation stays the supervisor's.
 */
export const agentExecutions = pgTable(
  "agent_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Nulled rather than cascaded: the record outlives the configuration. */
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    /** Set when a workflow's `agent.run` step started this execution (migration 0022). */
    workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id, { onDelete: "set null" }),
    /** Its own id on a root execution, so one equality finds the whole tree. */
    rootExecutionId: uuid("root_execution_id").notNull(),
    parentExecutionId: uuid("parent_execution_id"),
    /** Root to here, inclusive. Cycle detection is a membership test on this. */
    agentPath: uuid("agent_path").array().notNull(),
    depth: integer("depth").notNull().default(0),
    status: agentExecutionStatus("status").notNull().default("running"),
    /** Null on a root execution, whose input is the conversation. */
    inputTask: text("input_task"),
    output: text("output"),
    error: text("error"),
    /** The turn asked for a tool that stopped for a person; the action has not happened. */
    requiresApproval: boolean("requires_approval").notNull().default(false),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "agent_executions_parent_execution_id_fkey",
      columns: [table.parentExecutionId],
      foreignColumns: [table.id],
    }).onDelete("cascade"),
    check("agent_executions_depth_non_negative", sql`${table.depth} >= 0`),
    index("agent_executions_root_idx").on(table.rootExecutionId, table.startedAt),
    index("agent_executions_workspace_idx").on(table.workspaceId, table.startedAt.desc()),
    index("agent_executions_agent_idx")
      .on(table.agentId, table.startedAt.desc())
      .where(sql`${table.agentId} IS NOT NULL`),
  ],
);
