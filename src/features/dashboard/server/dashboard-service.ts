import "server-only";

import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";

import type {
  ChatbotPerformanceRow,
  CrmActivitySummary,
  DashboardStats,
  KnowledgeStatusSummary,
  UsageSummary,
  WorkflowActivitySummary,
} from "@/features/dashboard/types";
import { query, queryOne, withDb } from "@/server/db/client";
import { chatbots, contacts, conversations, messages, usageEvents, workflowRuns, workflows } from "@/server/db/schema";
import { toIso, toIsoRequired } from "@/server/db/sql";

/** Connection-less builder, used only to COMPOSE correlated subqueries. */
const qb = new QueryBuilder();

/**
 * Read-only aggregates for the workspace dashboard. Each function backs one
 * dashboard section so sections can stream independently.
 *
 * ── Why some statements here are still raw SQL ──────────────────────────────
 *
 * The tile counters return a dozen unrelated `count(*)`s in ONE round trip,
 * which makes them SELECTs with no FROM clause; Drizzle's select builder
 * requires a table to select from, so expressing them through it means one
 * statement per number - a dozen concurrent statements per dashboard against a
 * pool of ten. The daily-messages series is a `generate_series` CTE, which is
 * a set-returning function in the FROM clause and has no builder equivalent.
 *
 * Everything with a real FROM - the usage totals, the chatbot table, the
 * recent-run and recent-contact lists - is an ordinary Drizzle query. Both
 * exceptions are recorded in `docs/drizzle-orm-migration-plan.md`.
 */

export async function getDashboardStats(workspaceId: string): Promise<DashboardStats> {
  const row = await queryOne<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM chatbots WHERE workspace_id = $1 AND status = 'active') AS active_chatbots,
       (SELECT count(*) FROM chatbots WHERE workspace_id = $1 AND status <> 'archived') AS total_chatbots,
       (SELECT count(*) FROM conversations WHERE workspace_id = $1 AND created_at >= now() - interval '7 days') AS conv_7,
       (SELECT count(*) FROM conversations WHERE workspace_id = $1 AND created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days') AS conv_prev,
       (SELECT count(*) FROM messages WHERE workspace_id = $1 AND created_at >= now() - interval '7 days') AS msg_7,
       (SELECT count(*) FROM messages WHERE workspace_id = $1 AND created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days') AS msg_prev,
       (SELECT count(*) FROM contacts WHERE workspace_id = $1) AS contacts,
       (SELECT count(*) FROM contacts WHERE workspace_id = $1 AND created_at >= now() - interval '7 days') AS new_contacts,
       (SELECT count(*) FROM workflow_runs WHERE workspace_id = $1 AND created_at >= now() - interval '7 days') AS runs_7,
       (SELECT count(*) FROM workflow_runs WHERE workspace_id = $1 AND status = 'failed' AND created_at >= now() - interval '7 days') AS failed_7`,
    [workspaceId],
  );
  const n = (key: string) => Number(row?.[key] ?? 0);
  return {
    activeChatbots: n("active_chatbots"),
    totalChatbots: n("total_chatbots"),
    conversationsLast7Days: n("conv_7"),
    conversationsPrevious7Days: n("conv_prev"),
    messagesLast7Days: n("msg_7"),
    messagesPrevious7Days: n("msg_prev"),
    contacts: n("contacts"),
    newContactsLast7Days: n("new_contacts"),
    workflowRunsLast7Days: n("runs_7"),
    failedRunsLast7Days: n("failed_7"),
  };
}

export async function getUsageSummary(workspaceId: string, days = 14): Promise<UsageSummary> {
  const [daily, totals] = await Promise.all([
    query<{ day: string; count: string }>(
      `WITH days AS (
         SELECT generate_series(date_trunc('day', now()) - ($2::int - 1) * interval '1 day', date_trunc('day', now()), interval '1 day')::date AS day
       )
       SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
              coalesce((SELECT count(*) FROM messages m WHERE m.workspace_id = $1 AND m.role = 'user' AND m.created_at::date = days.day), 0) AS count
       FROM days ORDER BY days.day`,
      [workspaceId, days],
    ),
    // One pass over the window, with the three metrics separated by `FILTER`.
    withDb((db) =>
      db
        .select({
          tokensIn: sql<number>`coalesce(sum(${usageEvents.quantity}) FILTER (WHERE ${usageEvents.kind} = 'tokens_in'), 0)`.mapWith(Number),
          tokensOut:
            sql<number>`coalesce(sum(${usageEvents.quantity}) FILTER (WHERE ${usageEvents.kind} = 'tokens_out'), 0)`.mapWith(Number),
          messages: sql<number>`coalesce(sum(${usageEvents.quantity}) FILTER (WHERE ${usageEvents.kind} = 'message'), 0)`.mapWith(Number),
        })
        .from(usageEvents)
        .where(and(eq(usageEvents.workspaceId, workspaceId), gte(usageEvents.occurredAt, sql`now() - interval '30 days'`))),
    ),
  ]);
  return {
    dailyMessages: daily.map((row) => ({ date: row.day, count: Number(row.count) })),
    tokensInLast30Days: totals[0]?.tokensIn ?? 0,
    tokensOutLast30Days: totals[0]?.tokensOut ?? 0,
    messagesLast30Days: totals[0]?.messages ?? 0,
  };
}

/*
 * Recent activity used to be read here. It now lives in the audit feature,
 * which owns `activity_log` and its filtered read model: two queries over one
 * table, in two features, is exactly the drift the conventions warn about.
 * See `listRecentActivity` in `src/features/audit/server/audit-service.ts`.
 */

export async function getChatbotPerformance(workspaceId: string, limit = 5): Promise<ChatbotPerformanceRow[]> {
  const rows = await withDb((db) =>
    db
      .select({
        id: chatbots.id,
        name: chatbots.name,
        status: chatbots.status,
        // Composed rather than templated: in a select list with no join Drizzle
        // drops the table name from an interpolated column, which would turn
        // the correlation into `"chatbot_id" = "id"` inside the subquery.
        // `.as()` is required, not decorative: Drizzle does not emit an AS
        // clause for a select field on its own, so ordering by the name below
        // would fail with `column "conversations" does not exist`.
        conversations: sql<number>`${qb
          .select({ c: sql`count(*)` })
          .from(conversations)
          .where(
            and(eq(conversations.chatbotId, chatbots.id), gte(conversations.createdAt, sql`now() - interval '7 days'`)),
          )}`
          .mapWith(Number)
          .as("conversations"),
        messages: sql<number>`${qb
          .select({ c: sql`count(*)` })
          .from(messages)
          .innerJoin(conversations, eq(conversations.id, messages.conversationId))
          .where(and(eq(conversations.chatbotId, chatbots.id), gte(messages.createdAt, sql`now() - interval '7 days'`)))}`
          .mapWith(Number)
          .as("messages"),
      })
      .from(chatbots)
      .where(and(eq(chatbots.workspaceId, workspaceId), ne(chatbots.status, "archived")))
      // Ordered by the output column, so the busiest chatbot leads without the
      // subquery being evaluated a second time.
      .orderBy(sql`conversations DESC`, desc(chatbots.updatedAt))
      .limit(limit),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    conversationsLast7Days: row.conversations,
    messagesLast7Days: row.messages,
  }));
}

export async function getKnowledgeStatus(workspaceId: string): Promise<KnowledgeStatusSummary> {
  const row = await queryOne<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM knowledge_collections WHERE workspace_id = $1) AS kbs,
       (SELECT count(*) FROM knowledge_collections WHERE workspace_id = $1 AND status = 'ready') AS ready,
       (SELECT count(*) FROM knowledge_collections WHERE workspace_id = $1 AND status = 'processing') AS processing,
       (SELECT count(*) FROM knowledge_collections WHERE workspace_id = $1 AND status = 'error') AS error,
       (SELECT count(*) FROM knowledge_sources WHERE workspace_id = $1) AS sources,
       (SELECT count(*) FROM knowledge_sources WHERE workspace_id = $1 AND status = 'ready') AS sources_ready`,
    [workspaceId],
  );
  const n = (key: string) => Number(row?.[key] ?? 0);
  return { collections: n("kbs"), ready: n("ready"), processing: n("processing"), error: n("error"), sources: n("sources"), sourcesReady: n("sources_ready") };
}

export async function getWorkflowActivity(workspaceId: string): Promise<WorkflowActivitySummary> {
  const [counts, runs] = await Promise.all([
    queryOne<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM workflows WHERE workspace_id = $1 AND status = 'active') AS active,
         (SELECT count(*) FROM workflow_runs WHERE workspace_id = $1 AND created_at >= now() - interval '7 days') AS runs,
         (SELECT count(*) FROM workflow_runs WHERE workspace_id = $1 AND status = 'succeeded' AND created_at >= now() - interval '7 days') AS succeeded,
         (SELECT count(*) FROM workflow_runs WHERE workspace_id = $1 AND status = 'failed' AND created_at >= now() - interval '7 days') AS failed`,
      [workspaceId],
    ),
    withDb((db) =>
      db
        .select({
          id: workflowRuns.id,
          workflowId: workflowRuns.workflowId,
          workflowName: workflows.name,
          status: workflowRuns.status,
          startedAt: workflowRuns.startedAt,
          finishedAt: workflowRuns.finishedAt,
        })
        .from(workflowRuns)
        .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
        .where(eq(workflowRuns.workspaceId, workspaceId))
        .orderBy(desc(workflowRuns.createdAt))
        .limit(5),
    ),
  ]);
  const n = (key: string) => Number(counts?.[key] ?? 0);
  return {
    activeWorkflows: n("active"),
    runsLast7Days: n("runs"),
    succeededLast7Days: n("succeeded"),
    failedLast7Days: n("failed"),
    recentRuns: runs.map((run) => ({
      id: run.id,
      workflowId: run.workflowId,
      workflowName: run.workflowName,
      status: run.status,
      startedAt: toIso(run.startedAt),
      finishedAt: toIso(run.finishedAt),
    })),
  };
}

export async function getCrmActivity(workspaceId: string): Promise<CrmActivitySummary> {
  const [counts, recent] = await Promise.all([
    queryOne<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM contacts WHERE workspace_id = $1) AS contacts,
         (SELECT count(*) FROM contacts WHERE workspace_id = $1 AND stage = 'lead') AS leads,
         (SELECT count(*) FROM contacts WHERE workspace_id = $1 AND stage = 'customer') AS customers,
         (SELECT count(*) FROM contacts WHERE workspace_id = $1 AND created_at >= now() - interval '7 days') AS new_7`,
      [workspaceId],
    ),
    withDb((db) =>
      db
        .select({
          id: contacts.id,
          name: contacts.name,
          email: contacts.email,
          stage: contacts.stage,
          createdAt: contacts.createdAt,
        })
        .from(contacts)
        .where(eq(contacts.workspaceId, workspaceId))
        .orderBy(desc(contacts.createdAt))
        .limit(5),
    ),
  ]);
  const n = (key: string) => Number(counts?.[key] ?? 0);
  return {
    contacts: n("contacts"),
    leads: n("leads"),
    customers: n("customers"),
    newLast7Days: n("new_7"),
    recentContacts: recent.map((row) => ({ id: row.id, name: row.name, email: row.email, stage: row.stage, createdAt: toIsoRequired(row.createdAt) })),
  };
}
