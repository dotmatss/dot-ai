// @vitest-environment node
/**
 * The Chatbot -> Agent link, against real PostgreSQL.
 *
 * `chatbot-agent-runtime.test.ts` covers which configuration wins; this covers
 * the half only a database can answer:
 *
 *   1. The link is OPTIONAL. A chatbot with no agent behaves exactly as it did
 *      before migration 0020 - this is the regression that matters, because
 *      every existing chatbot in production is one of these.
 *   2. A cross-workspace link is refused by the DATABASE, not merely by the
 *      service, so the composite foreign key is doing what it was added for.
 *   3. Retiring an agent cannot silently break a live deployment: archiving or
 *      deleting a deployed agent is refused and the refusal names the chatbot.
 *   4. A conversation records the channel AND the worker, so history stays
 *      attributable after the link changes.
 *   5. Unlinking restores the chatbot's own configuration, which was kept
 *      rather than cleared.
 *
 * REQUIRES MIGRATION 0020. Skipped automatically without DATABASE_URL:
 *   DATABASE_URL="postgresql://…" node scripts/verify.mjs --tests chatbot-agent-persistence
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgent, deleteAgent, updateAgent, type ActorContext } from "@/features/agents/server/agent-service";
import { runChatbotChat } from "@/features/chatbots/server/chatbot-chat";
import { resolveChatbotRuntime } from "@/features/chatbots/server/chatbot-runtime";
import { createChatbot, getChatbot, updateChatbot } from "@/features/chatbots/server/chatbot-service";
import { readChatStream } from "@/lib/ai/sse-client";
import { isApiError } from "@/lib/api/api-error";
import { query, queryOne } from "@/server/db/client";
import type { ChatStreamEvent } from "@/types/ai";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suffix = Math.random().toString(36).slice(2, 10);

let actor: ActorContext;
let otherActor: ActorContext;
let organizationIds: string[] = [];

async function insertUser(email: string): Promise<string> {
  const row = await queryOne<{ id: string }>("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id", [
    email,
    "Chatbot Agent Tester",
  ]);
  if (!row) throw new Error("failed to insert user");
  return row.id;
}

async function insertTenant(label: string, ownerId: string): Promise<string> {
  const organization = await queryOne<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
    [`CbAgent ${label} ${suffix}`, `cbagent-${label}-${suffix}`],
  );
  if (!organization) throw new Error("failed to insert organization");
  organizationIds.push(organization.id);
  await query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [
    organization.id,
    ownerId,
  ]);
  const workspace = await queryOne<{ id: string }>(
    "INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
    [organization.id, `CbAgent WS ${label} ${suffix}`, `cbagent-ws-${label}-${suffix}`],
  );
  if (!workspace) throw new Error("failed to insert workspace");
  return workspace.id;
}

/** Runs one real turn through the shared pipeline and returns its conversation. */
async function runTurn(chatbotId: string): Promise<{ id: string; chatbot_id: string | null; agent_id: string | null }> {
  const chatbot = await getChatbot(actor.workspaceId, chatbotId);
  const response = await runChatbotChat({
    chatbot,
    input: { messages: [{ role: "user", content: "Do you offer refunds?" }] },
    channel: "playground",
    signal: new AbortController().signal,
  });
  const events: ChatStreamEvent[] = [];
  for await (const event of readChatStream(response)) events.push(event);

  const announced = events.find(
    (event): event is Extract<ChatStreamEvent, { type: "tool-result" }> =>
      event.type === "tool-result" && event.id === "conversation",
  );
  const conversationId = (announced?.result as { conversationId?: string } | undefined)?.conversationId;
  if (!conversationId) throw new Error("stream did not announce a conversation id");

  const row = await queryOne<{ id: string; chatbot_id: string | null; agent_id: string | null }>(
    "SELECT id, chatbot_id, agent_id FROM conversations WHERE workspace_id = $1 AND id = $2",
    [actor.workspaceId, conversationId],
  );
  if (!row) throw new Error("conversation was not persisted");
  return row;
}

describe.skipIf(!hasDatabase)("Chatbot to Agent link (PostgreSQL)", () => {
  beforeAll(async () => {
    const ownerId = await insertUser(`cbagent-${suffix}@example.test`);
    actor = { workspaceId: await insertTenant("a", ownerId), userId: ownerId };
    otherActor = { workspaceId: await insertTenant("b", ownerId), userId: ownerId };
  }, 30_000);

  afterAll(async () => {
    for (const organizationId of organizationIds) {
      await query("DELETE FROM organizations WHERE id = $1", [organizationId]);
    }
    organizationIds = [];
  });

  it("leaves a chatbot with no agent exactly as it was", async () => {
    const bot = await createChatbot(actor, { name: `Legacy ${suffix}` });
    await updateChatbot(actor, bot.id, {
      instructions: "You are the chatbot's own assistant.",
      modelConfig: { model: "fast", temperature: 0.7, maxTokens: 512 },
    });

    const reloaded = await getChatbot(actor.workspaceId, bot.id);
    expect(reloaded.agentId).toBeNull();
    expect(reloaded.agentName).toBeNull();

    const runtime = await resolveChatbotRuntime(reloaded);
    expect(runtime.source).toBe("chatbot");
    expect(runtime.systemPrompt).toContain("chatbot's own assistant");
    expect(runtime.modelConfig.maxTokens).toBe(512);

    // And a real turn still records only the channel, with no agent.
    const conversation = await runTurn(bot.id);
    expect(conversation.chatbot_id).toBe(bot.id);
    expect(conversation.agent_id).toBeNull();
  }, 30_000);

  it("deploys an agent and answers from it instead", async () => {
    const agent = await createAgent(actor, { name: `Deployed ${suffix}` });
    await updateAgent(actor, agent.id, {
      instructions: "You are the agent. Escalate billing questions.",
      modelConfig: { model: "quality", temperature: 0.1, maxTokens: 4096 },
      status: "active",
    });
    const bot = await createChatbot(actor, { name: `Deploying ${suffix}` });
    await updateChatbot(actor, bot.id, { instructions: "Chatbot instructions that must stop being used." });

    const linked = await updateChatbot(actor, bot.id, { agentId: agent.id });
    expect(linked.agentId).toBe(agent.id);
    expect(linked.agentName).toBe(`Deployed ${suffix}`);

    const runtime = await resolveChatbotRuntime(linked);
    expect(runtime.source).toBe("agent");
    expect(runtime.systemPrompt).toContain("Escalate billing questions");
    expect(runtime.systemPrompt).not.toContain("must stop being used");
    expect(runtime.modelConfig.maxTokens).toBe(4096);

    // The conversation records both: the channel it arrived on and the worker
    // that answered.
    const conversation = await runTurn(bot.id);
    expect(conversation.chatbot_id).toBe(bot.id);
    expect(conversation.agent_id).toBe(agent.id);
  }, 30_000);

  it("refuses another workspace's agent in the service and in the database", async () => {
    const theirAgent = await createAgent(otherActor, { name: `Theirs ${suffix}` });
    const bot = await createChatbot(actor, { name: `Boundary ${suffix}` });

    await expect(updateChatbot(actor, bot.id, { agentId: theirAgent.id })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 422,
    );

    // The service check is not the only thing standing there: the composite
    // foreign key refuses the write even when the service is bypassed, which
    // is the whole reason it is composite.
    await expect(
      query("UPDATE chatbots SET agent_id = $1 WHERE workspace_id = $2 AND id = $3", [
        theirAgent.id,
        actor.workspaceId,
        bot.id,
      ]),
    ).rejects.toThrow();

    expect((await getChatbot(actor.workspaceId, bot.id)).agentId).toBeNull();
  }, 30_000);

  it("refuses to deploy an archived agent", async () => {
    const agent = await createAgent(actor, { name: `Retired ${suffix}` });
    await updateAgent(actor, agent.id, { status: "archived" });
    const bot = await createChatbot(actor, { name: `Wants retired ${suffix}` });

    await expect(updateChatbot(actor, bot.id, { agentId: agent.id })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 422,
    );
  }, 30_000);

  it("will not archive or delete an agent a chatbot is deploying", async () => {
    const agent = await createAgent(actor, { name: `Busy ${suffix}` });
    await updateAgent(actor, agent.id, { instructions: "Answer questions.", status: "active" });
    const bot = await createChatbot(actor, { name: `Live deployment ${suffix}` });
    await updateChatbot(actor, bot.id, { agentId: agent.id });

    // Both are refused with a message naming the deployment, rather than a
    // foreign-key violation or a silently broken widget.
    const archiveError = await updateAgent(actor, agent.id, { status: "archived" }).catch((error: unknown) => error);
    expect(isApiError(archiveError) && archiveError.status).toBe(409);
    expect(isApiError(archiveError) && archiveError.message).toContain(`Live deployment ${suffix}`);

    const deleteError = await deleteAgent(actor, agent.id).catch((error: unknown) => error);
    expect(isApiError(deleteError) && deleteError.status).toBe(409);
    expect(isApiError(deleteError) && deleteError.message).toContain(`Live deployment ${suffix}`);

    // The deployment is untouched and still serving the agent.
    const runtime = await resolveChatbotRuntime(await getChatbot(actor.workspaceId, bot.id));
    expect(runtime.source).toBe("agent");
  }, 30_000);

  it("restores the chatbot's own configuration when it is unlinked", async () => {
    const agent = await createAgent(actor, { name: `Temporary ${suffix}` });
    await updateAgent(actor, agent.id, { instructions: "Agent instructions.", status: "active" });
    const bot = await createChatbot(actor, { name: `Reverting ${suffix}` });
    await updateChatbot(actor, bot.id, {
      instructions: "The chatbot's own instructions, kept all along.",
      collectionIds: [],
    });
    await updateChatbot(actor, bot.id, { agentId: agent.id });

    const unlinked = await updateChatbot(actor, bot.id, { agentId: null });
    expect(unlinked.agentId).toBeNull();

    // Nothing was destroyed by linking, so unlinking is a complete return to
    // the previous behaviour rather than a blank chatbot.
    const runtime = await resolveChatbotRuntime(unlinked);
    expect(runtime.source).toBe("chatbot");
    expect(runtime.systemPrompt).toContain("kept all along");

    // ...and the agent can now be retired, because nothing deploys it.
    await expect(updateAgent(actor, agent.id, { status: "archived" })).resolves.toMatchObject({ status: "archived" });
  }, 30_000);

  it("keeps earlier conversations attributed after the chatbot is reassigned", async () => {
    const first = await createAgent(actor, { name: `First ${suffix}` });
    const second = await createAgent(actor, { name: `Second ${suffix}` });
    for (const agent of [first, second]) {
      await updateAgent(actor, agent.id, { instructions: "Answer questions.", status: "active" });
    }
    const bot = await createChatbot(actor, { name: `Reassigned ${suffix}` });

    await updateChatbot(actor, bot.id, { agentId: first.id });
    const before = await runTurn(bot.id);
    expect(before.agent_id).toBe(first.id);

    await updateChatbot(actor, bot.id, { agentId: second.id });
    const after = await runTurn(bot.id);
    expect(after.agent_id).toBe(second.id);

    // History is not rewritten: the first conversation still names the agent
    // that actually handled it.
    const stored = await queryOne<{ agent_id: string | null }>(
      "SELECT agent_id FROM conversations WHERE workspace_id = $1 AND id = $2",
      [actor.workspaceId, before.id],
    );
    expect(stored?.agent_id).toBe(first.id);
  }, 30_000);
});
