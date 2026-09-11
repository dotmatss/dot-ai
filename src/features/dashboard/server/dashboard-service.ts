import "server-only";

import type {
  ActivityEntry,
  ChatbotPerformanceRow,
  CrmActivitySummary,
  DashboardStats,
  KnowledgeStatusSummary,
  UsageSummary,
  WorkflowActivitySummary,
} from "@/features/dashboard/types";
import { query, queryOne } from "@/server/db/client";
import { toIso, toIsoRequired } from "@/server/db/sql";

/**
 * Read-only aggregates for the workspace dashboard. Each function backs one
 * dashboard section so sections can stream independently.
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
    queryOne<{ tokens_in: string; tokens_out: string; messages: string }>(
      `SELECT
         coalesce(sum(quantity) FILTER (WHERE kind = 'tokens_in'), 0) AS tokens_in,
         coalesce(sum(quantity) FILTER (WHERE kind = 'tokens_out'), 0) AS tokens_out,
         coalesce(sum(quantity) FILTER (WHERE kind = 'message'), 0) AS messages
       FROM usage_events WHERE workspace_id = $1 AND occurred_at >= now() - interval '30 days'`,
      [workspaceId],
    ),
  ]);
  return {
    dailyMessages: daily.map((row) => ({ date: row.day, count: Number(row.count) })),
    tokensInLast30Days: Number(totals?.tokens_in ?? 0),
    tokensOutLast30Days: Number(totals?.tokens_out ?? 0),
    messagesLast30Days: Number(totals?.messages ?? 0),
  };
}

export async function getRecentActivity(workspaceId: string, limit = 10): Promise<ActivityEntry[]> {
  const rows = await query<{
    id: string;
    actor_name: string | null;
    entity_type: string;
    entity_id: string | null;
    action: string;
    summary: string;
    created_at: Date;
  }>(
    `SELECT a.id::text AS id, u.name AS actor_name, a.entity_type, a.entity_id, a.action, a.summary, a.created_at
     FROM activity_log a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.workspace_id = $1 ORDER BY a.created_at DESC LIMIT $2`,
    [workspaceId, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    actorName: row.actor_name,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    summary: row.summary,
    createdAt: toIsoRequired(row.created_at),
  }));
}

export async function getChatbotPerformance(workspaceId: string, limit = 5): Promise<ChatbotPerformanceRow[]> {
  const rows = await query<{ id: string; name: string; status: string; conversations: string; messages: string }>(
    `SELECT cb.id, cb.name, cb.status,
            (SELECT count(*) FROM conversations c WHERE c.chatbot_id = cb.id AND c.created_at >= now() - interval '7 days') AS conversations,
            (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.chatbot_id = cb.id AND m.created_at >= now() - interval '7 days') AS messages
     FROM chatbots cb WHERE cb.workspace_id = $1 AND cb.status <> 'archived'
     ORDER BY conversations DESC, cb.updated_at DESC LIMIT $2`,
    [workspaceId, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    conversationsLast7Days: Number(row.conversations),
    messagesLast7Days: Number(row.messages),
  }));
}

export async function getKnowledgeStatus(workspaceId: string): Promise<KnowledgeStatusSummary> {
  const row = await queryOne<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM knowledge_bases WHERE workspace_id = $1) AS kbs,
       (SELECT count(*) FROM knowledge_bases WHERE workspace_id = $1 AND status = 'ready') AS ready,
       (SELECT count(*) FROM knowledge_bases WHERE workspace_id = $1 AND status = 'processing') AS processing,
       (SELECT count(*) FROM knowledge_bases WHERE workspace_id = $1 AND status = 'error') AS error,
       (SELECT count(*) FROM knowledge_sources WHERE workspace_id = $1) AS sources,
       (SELECT count(*) FROM knowledge_sources WHERE workspace_id = $1 AND status = 'ready') AS sources_ready`,
    [workspaceId],
  );
  const n = (key: string) => Number(row?.[key] ?? 0);
  return { knowledgeBases: n("kbs"), ready: n("ready"), processing: n("processing"), error: n("error"), sources: n("sources"), sourcesReady: n("sources_ready") };
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
    query<{ id: string; workflow_id: string; workflow_name: string; status: string; started_at: Date | null; finished_at: Date | null }>(
      `SELECT r.id, r.workflow_id, w.name AS workflow_name, r.status, r.started_at, r.finished_at
       FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id
       WHERE r.workspace_id = $1 ORDER BY r.created_at DESC LIMIT 5`,
      [workspaceId],
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
      workflowId: run.workflow_id,
      workflowName: run.workflow_name,
      status: run.status,
      startedAt: toIso(run.started_at),
      finishedAt: toIso(run.finished_at),
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
    query<{ id: string; name: string | null; email: string | null; stage: string; created_at: Date }>(
      `SELECT id, name, email, stage, created_at FROM contacts WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [workspaceId],
    ),
  ]);
  const n = (key: string) => Number(counts?.[key] ?? 0);
  return {
    contacts: n("contacts"),
    leads: n("leads"),
    customers: n("customers"),
    newLast7Days: n("new_7"),
    recentContacts: recent.map((row) => ({ id: row.id, name: row.name, email: row.email, stage: row.stage, createdAt: toIsoRequired(row.created_at) })),
  };
}
