import "server-only";

import { count, gte, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";

import { getServerEnv } from "@/config/env";
import type { PlatformHealth, PlatformOverview } from "@/features/platform/types";
import { getEmbeddingProvider } from "@/features/knowledge/server/embeddings";
import { pingDatabase, queryOne, withDb } from "@/server/db/client";
import { conversations, usageEvents, users } from "@/server/db/schema";

/** Connection-less builder, used only to COMPOSE correlated subqueries. */
const qb = new QueryBuilder();

/**
 * Platform-wide counters and operational signals for the Overview page.
 *
 * ── Cost of this page ───────────────────────────────────────────────────────
 *
 * Four statements, run concurrently, none of them per-tenant. The alternative -
 * a metric per card - was rejected because it grows a query every time someone
 * adds a tile, and the tiles are the part of an operator dashboard that grows.
 *
 * The counters over `organizations`, `users` and `workspaces` are plain
 * `count(*)` over small tables. The build counts are four `count(*)`s in one
 * statement. The activity figures are a single pass over `usage_events` and
 * `conversations` restricted to a 30-day window, which is what the
 * `usage_events_workspace_time_idx` and the conversations time index serve.
 *
 * If the platform grows to where these stop being cheap, the fix is a
 * materialized rollup refreshed on a schedule - not a warehouse, and not
 * client-side aggregation. That threshold is not here yet, and guessing at it
 * early would add a cache to invalidate for no measured gain.
 *
 * ── Why two of the four are still raw SQL ───────────────────────────────────
 *
 * `counts` and `build` each return several unrelated scalar aggregates in ONE
 * round trip, which makes them SELECTs with no FROM clause. Drizzle's select
 * builder requires a table to select from, so the only way to express them
 * through it is to split each into one statement per figure - nine concurrent
 * statements for this page instead of four, against a pool of ten. That is a
 * real regression to buy uniformity, so they stay as written and are counted
 * as justified exceptions in `docs/drizzle-orm-migration-plan.md`.
 *
 * The other two have a real FROM and are ordinary Drizzle aggregates; only
 * their `FILTER` clauses stay as SQL, because that is the PostgreSQL construct
 * that keeps each of them a single pass.
 *
 * ── Honesty ─────────────────────────────────────────────────────────────────
 *
 * Token and message figures are summed from `usage_events`, which this
 * application writes on its own request path. They are a faithful record of
 * what this system metered, NOT a reconciliation against a provider's billing,
 * and the UI labels them as such. Nothing here is estimated, extrapolated or
 * filled in.
 */

interface CountsRow {
  organizations_total: string;
  organizations_active: string;
  organizations_suspended: string;
  organizations_disabled: string;
  workspaces_total: string;
}

interface BuildRow {
  chatbots: string;
  agents: string;
  workflows: string;
  collections: string;
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const [counts, userRows, build, activityRows, health] = await Promise.all([
    queryOne<CountsRow>(
      `SELECT (SELECT count(*) FROM organizations)                              AS organizations_total,
              (SELECT count(*) FROM organizations WHERE status = 'active')      AS organizations_active,
              (SELECT count(*) FROM organizations WHERE status = 'suspended')   AS organizations_suspended,
              (SELECT count(*) FROM organizations WHERE status = 'disabled')    AS organizations_disabled,
              (SELECT count(*) FROM workspaces)                                 AS workspaces_total`,
    ),
    withDb((db) =>
      db
        .select({
          total: count(),
          disabled: sql<number>`count(*) FILTER (WHERE ${users.disabledAt} IS NOT NULL)`.mapWith(Number),
          newLast30Days: sql<number>`count(*) FILTER (WHERE ${users.createdAt} >= now() - interval '30 days')`.mapWith(Number),
        })
        .from(users),
    ),
    queryOne<BuildRow>(
      `SELECT (SELECT count(*) FROM chatbots)              AS chatbots,
              (SELECT count(*) FROM agents)                AS agents,
              (SELECT count(*) FROM workflows)             AS workflows,
              (SELECT count(*) FROM knowledge_collections) AS collections`,
    ),
    withDb((db) =>
      db
        .select({
          // A constant scalar subquery beside the aggregates, so the two
          // 30-day figures still arrive in one round trip. Composed with the
          // builder like every other subquery, which keeps its column
          // references qualified rather than dependent on the enclosing shape.
          conversations: sql<number>`${qb
            .select({ c: sql`count(*)` })
            .from(conversations)
            .where(gte(conversations.createdAt, sql`now() - interval '30 days'`))}`.mapWith(Number),
          messages: sql<number>`coalesce(sum(${usageEvents.quantity}) FILTER (WHERE ${usageEvents.kind} = 'message'), 0)`.mapWith(Number),
          workflowRuns:
            sql<number>`coalesce(sum(${usageEvents.quantity}) FILTER (WHERE ${usageEvents.kind} = 'workflow_run'), 0)`.mapWith(Number),
          tokensIn:
            sql<number>`coalesce(sum(${usageEvents.quantity}) FILTER (WHERE ${usageEvents.kind} = 'tokens_in'), 0)`.mapWith(Number),
          tokensOut:
            sql<number>`coalesce(sum(${usageEvents.quantity}) FILTER (WHERE ${usageEvents.kind} = 'tokens_out'), 0)`.mapWith(Number),
        })
        .from(usageEvents)
        .where(gte(usageEvents.occurredAt, sql`now() - interval '30 days'`)),
    ),
    getPlatformHealth(),
  ]);

  return {
    organizations: {
      total: Number(counts?.organizations_total ?? 0),
      active: Number(counts?.organizations_active ?? 0),
      suspended: Number(counts?.organizations_suspended ?? 0),
      disabled: Number(counts?.organizations_disabled ?? 0),
    },
    users: {
      total: userRows[0]?.total ?? 0,
      disabled: userRows[0]?.disabled ?? 0,
      newLast30Days: userRows[0]?.newLast30Days ?? 0,
    },
    workspaces: { total: Number(counts?.workspaces_total ?? 0) },
    build: {
      chatbots: Number(build?.chatbots ?? 0),
      agents: Number(build?.agents ?? 0),
      workflows: Number(build?.workflows ?? 0),
      collections: Number(build?.collections ?? 0),
    },
    activity: {
      conversationsLast30Days: activityRows[0]?.conversations ?? 0,
      messagesLast30Days: activityRows[0]?.messages ?? 0,
      workflowRunsLast30Days: activityRows[0]?.workflowRuns ?? 0,
      tokensInLast30Days: activityRows[0]?.tokensIn ?? 0,
      tokensOutLast30Days: activityRows[0]?.tokensOut ?? 0,
    },
    health,
  };
}

/**
 * Operational signals the server can actually observe.
 *
 * The rule this follows, and the reason two of the three report `unknown`:
 * a dashboard must not draw a green tick for something it never checked.
 *
 * - **Database** is genuinely probed. `pingDatabase()` already exists for the
 *   /api/health endpoint and runs a real `SELECT version()`.
 * - **AI gateway** and **embeddings** report their CONFIGURATION, not their
 *   liveness, and say so. A live upstream probe on every dashboard load would
 *   spend money and add latency to a page an operator refreshes, and a cached
 *   probe result would be a liveness claim with an unstated age. Wiring a
 *   scheduled probe that writes its result somewhere is the honest way to turn
 *   these green, and it is deliberately not faked in the meantime.
 *
 * Nothing here returns a base URL, an API key or any part of one - only which
 * KIND of provider is selected.
 */
export async function getPlatformHealth(): Promise<PlatformHealth> {
  const database = await pingDatabase();

  return {
    database: database.ok
      ? { status: "healthy", detail: "Connected" }
      : { status: "unavailable", detail: database.error },
    aiGateway: aiGatewayHealth(),
    embeddings: embeddingHealth(),
  };
}

function aiGatewayHealth(): PlatformHealth["aiGateway"] {
  try {
    const env = getServerEnv();
    if (env.AI_PROVIDER === "mock") {
      return { status: "unknown", detail: "Mock gateway - no upstream provider is configured" };
    }
    if (!env.AI_GATEWAY_BASE_URL) {
      return { status: "unavailable", detail: "AI_PROVIDER=gateway but AI_GATEWAY_BASE_URL is not set" };
    }
    return { status: "unknown", detail: "Gateway configured. Liveness is not probed from this page" };
  } catch {
    // getServerEnv throws on malformed configuration. The message can name a
    // variable, so it is not forwarded verbatim.
    return { status: "unavailable", detail: "Server environment is not valid" };
  }
}

function embeddingHealth(): PlatformHealth["embeddings"] {
  try {
    const provider = getEmbeddingProvider();
    return provider.provider === "mock"
      ? {
          status: "unknown",
          detail: `Deterministic mock provider, ${provider.dimensions} dimensions - not a semantic model`,
        }
      : { status: "unknown", detail: `${provider.provider}, ${provider.dimensions} dimensions. Liveness is not probed` };
  } catch {
    return { status: "unavailable", detail: "Embedding provider could not be resolved" };
  }
}
