// @vitest-environment node
/**
 * Executes every migrated read once, against a real database.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The Drizzle migration shipped two defects that no unit test could see,
 * because the unit suite mocks the database boundary and therefore never sends
 * a statement to PostgreSQL:
 *
 *   1. Correlated subqueries lost their table qualification and silently
 *      counted nothing (see `correlated-subquery.test.ts`).
 *   2. `ORDER BY` referenced a select-list alias that Drizzle does not emit,
 *      which PostgreSQL rejected outright on the dashboard - and, in the
 *      analytics table, resolved to a TABLE of the same name and sorted by its
 *      whole-row composite instead of by the count.
 *
 * Both were in read paths that the feature integration suites never touch: the
 * dashboard, analytics and platform-overview services have no persistence test
 * of their own, because they compute rollups rather than own a table.
 *
 * So this is deliberately shallow and deliberately wide. It asserts almost
 * nothing about the RESULTS - only that every statement is valid SQL that the
 * server accepts. That is the exact property the other suites were not
 * checking, and the one that broke.
 *
 * Reads only. Nothing here writes, so it is safe against any database.
 */
import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  getAnalyticsKpis,
  getChannelMix,
  getConversationSeries,
  getCrmGrowth,
  getMessagesByChatbot,
  getTokenUsage,
  getUsageTotals,
  getWorkflowRunsSummary,
} from "@/features/analytics/server/analytics-service";
import { listEmbedDeployments } from "@/features/chatbots/server/embed-deployments";
import {
  getChatbotPerformance,
  getCrmActivity,
  getDashboardStats,
  getKnowledgeStatus,
  getUsageSummary,
  getWorkflowActivity,
} from "@/features/dashboard/server/dashboard-service";
import { listAiModels, listAiProviders, listEmbeddingModels } from "@/features/platform/server/ai-registry-repository";
import { getPlatformOverview } from "@/features/platform/server/platform-overview";
import {
  listOrganizations,
  listPlatformAudit,
  listPlatformAuditActions,
  listUsers,
} from "@/features/platform/server/platform-repository";
import { query } from "@/server/db/client";

const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * A workspace that actually holds rows, when the database has one. An empty
 * result set would still prove the SQL parses, but a populated one also
 * exercises the correlated subqueries and the ordering.
 */
let workspaceId: string = randomUUID();

beforeAll(async () => {
  if (!hasDatabase) return;
  const rows = await query<{ id: string }>("SELECT id FROM workspaces ORDER BY created_at LIMIT 1");
  if (rows[0]) workspaceId = rows[0].id;
}, 30_000);

describe.skipIf(!hasDatabase)("every migrated read executes against PostgreSQL", () => {
  it("runs the dashboard rollups", async () => {
    await expect(getDashboardStats(workspaceId)).resolves.toBeTruthy();
    await expect(getUsageSummary(workspaceId)).resolves.toBeTruthy();
    // The one that failed in production: `ORDER BY conversations` over an alias.
    await expect(getChatbotPerformance(workspaceId)).resolves.toBeInstanceOf(Array);
    await expect(getKnowledgeStatus(workspaceId)).resolves.toBeTruthy();
    await expect(getWorkflowActivity(workspaceId)).resolves.toBeTruthy();
    await expect(getCrmActivity(workspaceId)).resolves.toBeTruthy();
  });

  it("runs every analytics section", async () => {
    await expect(getAnalyticsKpis(workspaceId, "30d")).resolves.toBeTruthy();
    await expect(getConversationSeries(workspaceId, "30d")).resolves.toBeTruthy();
    await expect(getChannelMix(workspaceId, "30d")).resolves.toBeInstanceOf(Array);
    // Orders by an alias that shares its name with a table in the FROM clause.
    await expect(getMessagesByChatbot(workspaceId, "30d")).resolves.toBeInstanceOf(Array);
    await expect(getTokenUsage(workspaceId, "30d")).resolves.toBeTruthy();
    await expect(getWorkflowRunsSummary(workspaceId, "30d")).resolves.toBeTruthy();
    await expect(getCrmGrowth(workspaceId, "30d")).resolves.toBeTruthy();
    await expect(getUsageTotals(workspaceId, "30d")).resolves.toBeTruthy();
  });

  it("runs the platform plane reads", async () => {
    await expect(getPlatformOverview()).resolves.toBeTruthy();
    await expect(listOrganizations({})).resolves.toBeTruthy();
    await expect(listUsers({})).resolves.toBeTruthy();
    await expect(listPlatformAudit({})).resolves.toBeTruthy();
    await expect(listPlatformAuditActions()).resolves.toBeInstanceOf(Array);
  });

  it("runs the AI registry reads", async () => {
    await expect(listAiProviders()).resolves.toBeInstanceOf(Array);
    await expect(listAiModels()).resolves.toBeInstanceOf(Array);
    await expect(listEmbeddingModels()).resolves.toBeInstanceOf(Array);
  });

  it("runs the embed deployment read model", async () => {
    await expect(listEmbedDeployments(workspaceId)).resolves.toBeInstanceOf(Array);
  });
});
