// @vitest-environment node
/**
 * Integration test for one chatbot turn against real PostgreSQL: the SSE
 * contract, conversation and message persistence, usage metering and the
 * ownership check that keeps one chatbot out of another's conversation.
 *
 * Skipped automatically when DATABASE_URL is not configured, so the suite still
 * runs on a machine without a database:
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/dot_dev" pnpm exec vitest run chatbot-chat
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runChatbotChat } from "@/features/chatbots/server/chatbot-chat";
import { findChatbotById } from "@/features/chatbots/server/chatbot-repository";
import type { Chatbot } from "@/features/chatbots/types";
import { readChatStream } from "@/lib/ai/sse-client";
import { isApiError } from "@/lib/api/api-error";
import { closePool, query, queryOne } from "@/server/db/client";
import type { ChatStreamEvent } from "@/types/ai";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suffix = Math.random().toString(36).slice(2, 10);

interface Fixture {
  userId: string;
  organizationId: string;
  workspaceId: string;
  chatbot: Chatbot;
  otherChatbot: Chatbot;
}

let fixture: Fixture;

async function insertChatbot(workspaceId: string, userId: string, name: string, slug: string): Promise<Chatbot> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO chatbots (workspace_id, created_by, name, slug, instructions, embed_key, status)
     VALUES ($1, $2, $3, $4, 'You are a concise billing assistant.', $5, 'active')
     RETURNING id`,
    [workspaceId, userId, name, slug, `cb_test_${slug}_${suffix}`],
  );
  if (!row) throw new Error("failed to insert chatbot");
  const chatbot = await findChatbotById(workspaceId, row.id);
  if (!chatbot) throw new Error("inserted chatbot not found");
  return chatbot;
}

async function drain(response: Response): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of readChatStream(response)) events.push(event);
  return events;
}

function conversationIdFrom(events: ChatStreamEvent[]): string {
  for (const event of events) {
    if (event.type === "tool-result" && event.id === "conversation") {
      const result = event.result as { conversationId?: string };
      if (result?.conversationId) return result.conversationId;
    }
  }
  throw new Error("stream did not announce a conversation id");
}

describe.skipIf(!hasDatabase)("chatbot chat pipeline (PostgreSQL)", () => {
  beforeAll(async () => {
    const user = await queryOne<{ id: string }>(
      "INSERT INTO users (email, name) VALUES ($1, 'Integration Test') RETURNING id",
      [`chat-test-${suffix}@example.test`],
    );
    const organization = await queryOne<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
      [`Chat Test ${suffix}`, `chat-test-${suffix}`],
    );
    if (!user || !organization) throw new Error("failed to create fixture identity");
    await query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [
      organization.id,
      user.id,
    ]);
    const workspace = await queryOne<{ id: string }>(
      "INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
      [organization.id, `Chat WS ${suffix}`, `chat-ws-${suffix}`],
    );
    if (!workspace) throw new Error("failed to create fixture workspace");

    fixture = {
      userId: user.id,
      organizationId: organization.id,
      workspaceId: workspace.id,
      chatbot: await insertChatbot(workspace.id, user.id, "Billing Bot", `billing-${suffix}`),
      otherChatbot: await insertChatbot(workspace.id, user.id, "Other Bot", `other-${suffix}`),
    };
  }, 60_000);

  afterAll(async () => {
    if (!hasDatabase) return;
    // Deleting the organization cascades to workspace, chatbots, conversations,
    // messages and usage events, so the test leaves no rows behind.
    if (fixture?.organizationId) {
      await query("DELETE FROM organizations WHERE id = $1", [fixture.organizationId]);
      await query("DELETE FROM users WHERE id = $1", [fixture.userId]);
    }
    await closePool();
  });

  it("persists both turns, cites nothing without knowledge, and meters usage", async () => {
    const response = await runChatbotChat({
      chatbot: fixture.chatbot,
      input: { messages: [{ role: "user", content: "Do you offer refunds?" }] },
      channel: "playground",
      signal: new AbortController().signal,
    });

    const events = await drain(response);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
    const conversationId = conversationIdFrom(events);

    const conversation = await queryOne<{
      chatbot_id: string;
      channel: string;
      status: string;
      title: string;
      message_count: number;
      last_message_at: Date | null;
    }>(
      "SELECT chatbot_id, channel, status, title, message_count, last_message_at FROM conversations WHERE workspace_id = $1 AND id = $2",
      [fixture.workspaceId, conversationId],
    );
    expect(conversation).not.toBeNull();
    expect(conversation?.chatbot_id).toBe(fixture.chatbot.id);
    expect(conversation?.channel).toBe("playground");
    expect(conversation?.status).toBe("open");
    expect(conversation?.title).toBe("Do you offer refunds?");
    expect(conversation?.message_count).toBe(2);
    expect(conversation?.last_message_at).not.toBeNull();

    const messages = await query<{ role: string; content: string; usage: { inputTokens: number; outputTokens: number } | null; sources: unknown }>(
      "SELECT role, content, usage, sources FROM messages WHERE conversation_id = $1 ORDER BY created_at",
      [conversationId],
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("Do you offer refunds?");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toContain("You asked");
    expect(messages[1]?.usage?.outputTokens).toBeGreaterThan(0);
    // No collection is attached, so no citations are invented.
    expect(messages[1]?.sources).toBeNull();

    const usage = await query<{ kind: string; total: string }>(
      "SELECT kind, sum(quantity)::text AS total FROM usage_events WHERE workspace_id = $1 GROUP BY kind ORDER BY kind",
      [fixture.workspaceId],
    );
    const byKind = Object.fromEntries(usage.map((row) => [row.kind, Number(row.total)]));
    expect(byKind.message).toBe(1);
    expect(byKind.tokens_in).toBeGreaterThan(0);
    expect(byKind.tokens_out).toBeGreaterThan(0);
  }, 60_000);

  it("appends to an existing conversation when the caller passes its id", async () => {
    const first = await drain(
      await runChatbotChat({
        chatbot: fixture.chatbot,
        input: { messages: [{ role: "user", content: "First question" }] },
        channel: "widget",
        signal: new AbortController().signal,
      }),
    );
    const conversationId = conversationIdFrom(first);

    await drain(
      await runChatbotChat({
        chatbot: fixture.chatbot,
        input: {
          conversationId,
          messages: [
            { role: "user", content: "First question" },
            { role: "assistant", content: "Earlier answer" },
            { role: "user", content: "Follow-up question" },
          ],
        },
        channel: "widget",
        signal: new AbortController().signal,
      }),
    );

    const conversation = await queryOne<{ message_count: number }>(
      "SELECT message_count FROM conversations WHERE workspace_id = $1 AND id = $2",
      [fixture.workspaceId, conversationId],
    );
    // Two user messages plus two assistant replies; the replayed history is not re-stored.
    expect(conversation?.message_count).toBe(4);
  }, 60_000);

  it("refuses a conversation that belongs to a different chatbot", async () => {
    const events = await drain(
      await runChatbotChat({
        chatbot: fixture.chatbot,
        input: { messages: [{ role: "user", content: "Whose conversation is this?" }] },
        channel: "widget",
        signal: new AbortController().signal,
      }),
    );
    const conversationId = conversationIdFrom(events);

    await expect(
      runChatbotChat({
        chatbot: fixture.otherChatbot,
        input: { conversationId, messages: [{ role: "user", content: "Hijack attempt" }] },
        channel: "widget",
        signal: new AbortController().signal,
      }),
    ).rejects.toSatisfy((error) => isApiError(error) && error.code === "not_found");
  }, 60_000);

  it("rejects a turn with no user message", async () => {
    await expect(
      runChatbotChat({
        chatbot: fixture.chatbot,
        input: { messages: [{ role: "assistant", content: "I am talking to myself" }] },
        channel: "widget",
        signal: new AbortController().signal,
      }),
    ).rejects.toSatisfy((error) => isApiError(error) && error.code === "bad_request");
  }, 30_000);
});
