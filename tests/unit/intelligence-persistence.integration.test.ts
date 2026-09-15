// @vitest-environment node
/**
 * Integration test for Conversation Intelligence against real PostgreSQL: the
 * conversations read model, one full analysis run end to end, the outcome and
 * grounding signals it derives, clustering into topics, idempotence of a
 * re-run, counter recomputation, tenant isolation, and the one-run-per-
 * workspace lock.
 *
 * Skipped automatically when DATABASE_URL is not configured, so the suite still
 * runs on a machine without a database:
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5432/dot" node scripts/verify.mjs --tests intelligence
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listConversationsForAnalysis } from "@/features/conversations/server/analysis-source";
import { runConversationAnalysis } from "@/features/intelligence/server/analysis-run";
import {
  findLatestRun,
  getOverview,
  listTopicInsights,
  listTopics,
} from "@/features/intelligence/server/intelligence-repository";
import { getTopicConversations } from "@/features/intelligence/server/intelligence-service";
import { query, queryOne } from "@/server/db/client";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suffix = Math.random().toString(36).slice(2, 10);

interface Fixture {
  ownerId: string;
  organizationId: string;
  otherOrganizationId: string;
  workspaceId: string;
  otherWorkspaceId: string;
  chatbotId: string;
}

let fixture: Fixture;

async function insertUser(email: string, name: string): Promise<string> {
  const row = await queryOne<{ id: string }>("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id", [email, name]);
  if (!row) throw new Error("failed to insert user");
  return row.id;
}

async function insertTenant(label: string, ownerId: string): Promise<{ organizationId: string; workspaceId: string }> {
  const organization = await queryOne<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [
    `CI ${label} ${suffix}`,
    `ci-${label}-${suffix}`,
  ]);
  if (!organization) throw new Error("failed to insert organization");
  await query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [
    organization.id,
    ownerId,
  ]);
  const workspace = await queryOne<{ id: string }>(
    "INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
    [organization.id, `CI WS ${label} ${suffix}`, `ci-ws-${label}-${suffix}`],
  );
  if (!workspace) throw new Error("failed to insert workspace");
  return { organizationId: organization.id, workspaceId: workspace.id };
}

interface SeedConversation {
  workspaceId?: string;
  question: string;
  status?: "open" | "resolved" | "escalated";
  /** Citations attached to the assistant reply. */
  sources?: number;
  /** When set, the assistant reply is attributed to a team member. */
  humanReply?: boolean;
}

async function seedConversation(input: SeedConversation): Promise<string> {
  const workspaceId = input.workspaceId ?? fixture.workspaceId;
  const conversation = await queryOne<{ id: string }>(
    `INSERT INTO conversations (workspace_id, chatbot_id, channel, status, title, message_count)
     VALUES ($1, $2, 'widget', $3, $4, 2) RETURNING id`,
    [workspaceId, fixture.chatbotId, input.status ?? "open", input.question.slice(0, 60)],
  );
  if (!conversation) throw new Error("failed to insert conversation");

  await query(`INSERT INTO messages (workspace_id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`, [
    workspaceId,
    conversation.id,
    input.question,
  ]);

  const sources =
    input.sources && input.sources > 0
      ? JSON.stringify(Array.from({ length: input.sources }, (_, i) => ({ id: `s${i}`, title: `Doc ${i}`, snippet: "…" })))
      : null;

  await query(
    `INSERT INTO messages (workspace_id, conversation_id, role, content, sources, author_id)
     VALUES ($1, $2, 'assistant', $3, $4::jsonb, $5)`,
    [workspaceId, conversation.id, "Here is an answer.", sources, input.humanReply ? fixture.ownerId : null],
  );

  return conversation.id;
}

describe.skipIf(!hasDatabase)("Conversation Intelligence persistence (PostgreSQL)", () => {
  // A run embeds every question and streams a model call per topic. The mock
  // gateway streams word by word with a real delay, so the default 5s timeout
  // is not enough for the end-to-end cases.
  const RUN_TIMEOUT = 60_000;

  beforeAll(async () => {
    const ownerId = await insertUser(`ci-owner-${suffix}@example.test`, "Ada Owner");
    const tenant = await insertTenant("a", ownerId);
    const otherTenant = await insertTenant("b", ownerId);
    const chatbot = await queryOne<{ id: string }>(
      `INSERT INTO chatbots (workspace_id, created_by, name, slug, embed_key) VALUES ($1, $2, 'Support Bot', $3, $4) RETURNING id`,
      [tenant.workspaceId, ownerId, `ci-support-${suffix}`, `cb_ci_${suffix}`],
    );
    if (!chatbot) throw new Error("failed to insert fixture chatbot");

    fixture = {
      ownerId,
      organizationId: tenant.organizationId,
      otherOrganizationId: otherTenant.organizationId,
      workspaceId: tenant.workspaceId,
      otherWorkspaceId: otherTenant.workspaceId,
      chatbotId: chatbot.id,
    };
  });

  afterAll(async () => {
    if (!hasDatabase || !fixture) return;
    await query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [
      [fixture.organizationId, fixture.otherOrganizationId],
    ]);
    await query("DELETE FROM users WHERE id = $1", [fixture.ownerId]);
  });

  describe("the conversations read model", () => {
    it("reduces a thread to its opening question and its signals", async () => {
      const id = await seedConversation({
        question: "How long does a refund take to arrive",
        status: "resolved",
        sources: 2,
      });

      const rows = await listConversationsForAnalysis(fixture.workspaceId, {
        since: new Date(Date.now() - 60_000),
        limit: 100,
      });
      const row = rows.find((candidate) => candidate.conversationId === id);

      expect(row).toBeDefined();
      expect(row?.question).toBe("How long does a refund take to arrive");
      expect(row?.userMessageCount).toBe(1);
      expect(row?.sourceCount).toBe(2);
      expect(row?.humanReplyCount).toBe(0);
    });

    it("counts a reply written by a team member as a human reply", async () => {
      const id = await seedConversation({ question: "My card was charged twice today", humanReply: true });
      const rows = await listConversationsForAnalysis(fixture.workspaceId, {
        since: new Date(Date.now() - 60_000),
        limit: 100,
      });
      expect(rows.find((row) => row.conversationId === id)?.humanReplyCount).toBe(1);
    });

    it("skips a conversation with no user message, which has nothing to cluster on", async () => {
      const empty = await queryOne<{ id: string }>(
        `INSERT INTO conversations (workspace_id, chatbot_id, channel, status) VALUES ($1, $2, 'widget', 'open') RETURNING id`,
        [fixture.workspaceId, fixture.chatbotId],
      );
      const rows = await listConversationsForAnalysis(fixture.workspaceId, {
        since: new Date(Date.now() - 60_000),
        limit: 100,
      });
      expect(rows.some((row) => row.conversationId === empty?.id)).toBe(false);
    });

    it("never returns another workspace's conversations", async () => {
      await seedConversation({ workspaceId: fixture.otherWorkspaceId, question: "Leaked question from tenant B" });
      const rows = await listConversationsForAnalysis(fixture.workspaceId, {
        since: new Date(Date.now() - 60_000),
        limit: 100,
      });
      expect(rows.every((row) => row.question !== "Leaked question from tenant B")).toBe(true);
    });
  });

  describe("a full analysis run", () => {
    it("clusters conversations into topics and derives every signal", async () => {
      // Three phrasings of one subject, plus an unrelated one.
      await seedConversation({ question: "How do I reset my password", status: "resolved", sources: 1 });
      await seedConversation({ question: "How do I reset my password on mobile", status: "resolved", sources: 1 });
      await seedConversation({ question: "I cannot reset my password anywhere", status: "escalated" });

      const run = await runConversationAnalysis({
        workspaceId: fixture.workspaceId,
        userId: fixture.ownerId,
        windowDays: 1,
      });

      expect(run.status).toBe("succeeded");
      expect(run.conversationsAnalyzed).toBeGreaterThan(0);

      const topics = await listTopics(fixture.workspaceId, { sort: "volume", page: 1, pageSize: 50 });
      expect(topics.items.length).toBeGreaterThan(0);
      // Every topic carries a readable name even before a model labels it.
      expect(topics.items.every((topic) => topic.label.trim().length > 0)).toBe(true);

      const passwordTopic = topics.items.find((topic) => /password/i.test(topic.label));
      expect(passwordTopic).toBeDefined();
      expect(passwordTopic?.conversationCount).toBeGreaterThanOrEqual(2);
    }, RUN_TIMEOUT);

    it("derives outcome and grounding the way the metrics define them", async () => {
      const topics = await listTopics(fixture.workspaceId, { sort: "volume", page: 1, pageSize: 50 });
      const all = await Promise.all(
        topics.items.map((topic) => listTopicInsights(fixture.workspaceId, topic.id, { page: 1, pageSize: 100 })),
      );
      const insights = all.flatMap((page) => page.items);

      const doubleCharge = insights.find((insight) => insight.question.startsWith("My card was charged twice"));
      // A team member replied, so it is a hand-off however the status reads.
      expect(doubleCharge?.outcome).toBe("handed_off");
      expect(doubleCharge?.grounded).toBe(false);

      const refund = insights.find((insight) => insight.question.startsWith("How long does a refund"));
      expect(refund?.outcome).toBe("contained");
      expect(refund?.grounded).toBe(true);
      expect(refund?.sourceCount).toBe(2);

      const escalated = insights.find((insight) => insight.question.startsWith("I cannot reset my password"));
      expect(escalated?.outcome).toBe("escalated");
    });

    it("keeps topic counters equal to the insights behind them", async () => {
      const topics = await listTopics(fixture.workspaceId, { sort: "volume", page: 1, pageSize: 50 });
      for (const topic of topics.items) {
        const insights = await listTopicInsights(fixture.workspaceId, topic.id, { page: 1, pageSize: 200 });
        expect(topic.conversationCount).toBe(insights.total);
        expect(topic.groundedCount).toBe(insights.items.filter((insight) => insight.grounded).length);
        expect(topic.containedCount).toBe(insights.items.filter((insight) => insight.outcome === "contained").length);
        expect(topic.escalatedCount).toBe(insights.items.filter((insight) => insight.outcome === "escalated").length);
        // The counters are a cache of the rows; a topic claiming more
        // conversations than exist is the failure this guards.
        expect(topic.conversationCount).toBeGreaterThan(0);
      }
    });

    it("is idempotent: re-running the same window does not duplicate anything", async () => {
      const before = await getOverview(fixture.workspaceId);

      await runConversationAnalysis({ workspaceId: fixture.workspaceId, userId: fixture.ownerId, windowDays: 1 });

      const after = await getOverview(fixture.workspaceId);
      expect(after.conversationsAnalyzed).toBe(before.conversationsAnalyzed);
      expect(after.containedCount).toBe(before.containedCount);
      expect(after.groundedCount).toBe(before.groundedCount);
    }, RUN_TIMEOUT);

    it("hydrates a topic's conversations through the conversations read model", async () => {
      const topics = await listTopics(fixture.workspaceId, { sort: "volume", page: 1, pageSize: 1 });
      const topic = topics.items[0];
      expect(topic).toBeDefined();
      if (!topic) return;

      const page = await getTopicConversations(fixture.workspaceId, topic.id, { page: 1, pageSize: 20 });
      expect(page.items.length).toBeGreaterThan(0);
      for (const item of page.items) {
        expect(item.channel).toBe("widget");
        expect(item.messageCount).toBeGreaterThan(0);
        expect(typeof item.question).toBe("string");
      }
    });

    it("dates a topic by its conversations, not by when the analysis ran", async () => {
      // The regression this guards: deriving first/last seen from analyzed_at
      // made every topic read "last seen: just now" after any run, because a
      // run re-analyzes its whole window and stamps every row with now().
      const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const conversation = await queryOne<{ id: string }>(
        `INSERT INTO conversations (workspace_id, chatbot_id, channel, status, title, message_count, created_at, last_message_at)
         VALUES ($1, $2, 'widget', 'resolved', 'Dated thread', 2, $3, $3) RETURNING id`,
        [fixture.workspaceId, fixture.chatbotId, old],
      );
      if (!conversation) throw new Error("failed to insert dated conversation");
      await query(
        `INSERT INTO messages (workspace_id, conversation_id, role, content, created_at) VALUES ($1, $2, 'user', $3, $4)`,
        [fixture.workspaceId, conversation.id, "Does the export run on a schedule", old],
      );
      await query(
        `INSERT INTO messages (workspace_id, conversation_id, role, content, created_at) VALUES ($1, $2, 'assistant', $3, $4)`,
        [fixture.workspaceId, conversation.id, "It does.", old],
      );

      await runConversationAnalysis({ workspaceId: fixture.workspaceId, userId: fixture.ownerId, windowDays: 30 });

      const row = await queryOne<{ conversation_at: Date; analyzed_at: Date }>(
        "SELECT conversation_at, analyzed_at FROM conversation_insights WHERE conversation_id = $1",
        [conversation.id],
      );
      expect(row).not.toBeNull();
      // Dated by the thread, analyzed now: the two must not be the same value.
      expect(row?.conversation_at.getTime()).toBe(old.getTime());
      expect(row!.analyzed_at.getTime()).toBeGreaterThan(row!.conversation_at.getTime());

      const topicId = await queryOne<{ topic_id: string | null }>(
        "SELECT topic_id FROM conversation_insights WHERE conversation_id = $1",
        [conversation.id],
      );
      if (!topicId?.topic_id) return;
      const topic = await queryOne<{ last_seen_at: Date | null }>(
        "SELECT last_seen_at FROM conversation_topics WHERE id = $1",
        [topicId.topic_id],
      );
      // A topic whose only conversation is five days old is not "seen" today.
      expect(topic?.last_seen_at?.getTime()).toBe(old.getTime());
    }, RUN_TIMEOUT);

    it("records the run with its window and provenance", async () => {
      const run = await findLatestRun(fixture.workspaceId);
      expect(run?.status).toBe("succeeded");
      expect(run?.finishedAt).not.toBeNull();
      expect(run?.windowStart).not.toBeNull();
      expect(run?.windowEnd).not.toBeNull();
    });

    it("leaves another workspace's analysis completely empty", async () => {
      // Tenant B has one conversation but has never been analyzed, and tenant
      // A's run must not have reached into it.
      const overview = await getOverview(fixture.otherWorkspaceId);
      expect(overview.conversationsAnalyzed).toBe(0);
      expect(overview.topicCount).toBe(0);
    });
  });

  describe("the one-run-per-workspace lock", () => {
    it("refuses a second run while one is in flight", async () => {
      // Claim the slot by hand, the way a run in progress would hold it.
      const held = await queryOne<{ id: string }>(
        `INSERT INTO conversation_analysis_runs (workspace_id, status) VALUES ($1, 'running') RETURNING id`,
        [fixture.workspaceId],
      );
      expect(held).not.toBeNull();

      try {
        await expect(
          runConversationAnalysis({ workspaceId: fixture.workspaceId, userId: fixture.ownerId, windowDays: 1 }),
        ).rejects.toMatchObject({ status: 409 });
      } finally {
        await query("DELETE FROM conversation_analysis_runs WHERE id = $1", [held?.id]);
      }
    });

    it("releases a run abandoned by a process that died", async () => {
      // Without this the partial unique index would lock the workspace out of
      // the feature permanently: nothing else would ever clear the row.
      const stale = await queryOne<{ id: string }>(
        `INSERT INTO conversation_analysis_runs (workspace_id, status, started_at)
         VALUES ($1, 'running', now() - interval '2 hours') RETURNING id`,
        [fixture.workspaceId],
      );
      expect(stale).not.toBeNull();

      const run = await runConversationAnalysis({
        workspaceId: fixture.workspaceId,
        userId: fixture.ownerId,
        windowDays: 1,
      });
      expect(run.status).toBe("succeeded");

      const released = await queryOne<{ status: string }>(
        "SELECT status FROM conversation_analysis_runs WHERE id = $1",
        [stale?.id],
      );
      expect(released?.status).toBe("failed");
    }, RUN_TIMEOUT);
  });
});
