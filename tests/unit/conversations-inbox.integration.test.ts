// @vitest-environment node
/**
 * Integration test for the conversations inbox against real PostgreSQL: the
 * joined list projection, filter behaviour (including "me" and message-body
 * search), tenant isolation, triage writes with their activity trail, the human
 * reply and the stored AI summary.
 *
 * Skipped automatically when DATABASE_URL is not configured, so the suite still
 * runs on a machine without a database:
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/dot_dev" node scripts/verify.mjs --tests conversations
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appendMessage,
  createConversation,
  findConversationDetail,
  listConversationMessages,
} from "@/features/conversations/server/conversation-repository";
import {
  getConversationDetail,
  getConversations,
  replyToConversation,
  summarizeConversation,
  updateConversation,
} from "@/features/conversations/server/conversation-service";
import { isApiError } from "@/lib/api/api-error";
import { getPool, query, queryOne } from "@/server/db/client";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suffix = Math.random().toString(36).slice(2, 10);

interface Fixture {
  ownerId: string;
  outsiderId: string;
  organizationId: string;
  otherOrganizationId: string;
  workspaceId: string;
  otherWorkspaceId: string;
  chatbotId: string;
  agentId: string;
  contactId: string;
  otherContactId: string;
  widgetConversationId: string;
  agentConversationId: string;
  otherTenantConversationId: string;
}

let fixture: Fixture;

async function insertUser(email: string, name: string): Promise<string> {
  const row = await queryOne<{ id: string }>("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id", [email, name]);
  if (!row) throw new Error("failed to insert user");
  return row.id;
}

async function insertTenant(label: string, ownerId: string): Promise<{ organizationId: string; workspaceId: string }> {
  const organization = await queryOne<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [
    `Inbox ${label} ${suffix}`,
    `inbox-${label}-${suffix}`,
  ]);
  if (!organization) throw new Error("failed to insert organization");
  await query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [organization.id, ownerId]);
  const workspace = await queryOne<{ id: string }>(
    "INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
    [organization.id, `Inbox WS ${label} ${suffix}`, `inbox-ws-${label}-${suffix}`],
  );
  if (!workspace) throw new Error("failed to insert workspace");
  return { organizationId: organization.id, workspaceId: workspace.id };
}

async function insertContact(workspaceId: string, name: string, email: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    "INSERT INTO contacts (workspace_id, name, email, company) VALUES ($1, $2, $3, 'Acme') RETURNING id",
    [workspaceId, name, email],
  );
  if (!row) throw new Error("failed to insert contact");
  return row.id;
}

describe.skipIf(!hasDatabase)("conversations inbox (PostgreSQL)", () => {
  beforeAll(async () => {
    const ownerId = await insertUser(`inbox-owner-${suffix}@example.test`, "Ada Owner");
    const outsiderId = await insertUser(`inbox-outsider-${suffix}@example.test`, "Grace Outsider");
    const tenant = await insertTenant("a", ownerId);
    const otherTenant = await insertTenant("b", outsiderId);

    const chatbot = await queryOne<{ id: string }>(
      `INSERT INTO chatbots (workspace_id, created_by, name, slug, embed_key) VALUES ($1, $2, 'Support Bot', $3, $4) RETURNING id`,
      [tenant.workspaceId, ownerId, `support-${suffix}`, `cb_inbox_${suffix}`],
    );
    const agent = await queryOne<{ id: string }>(
      "INSERT INTO agents (workspace_id, created_by, name) VALUES ($1, $2, 'Ops Agent') RETURNING id",
      [tenant.workspaceId, ownerId],
    );
    if (!chatbot || !agent) throw new Error("failed to insert fixture chatbot/agent");

    const contactId = await insertContact(tenant.workspaceId, "Rae Customer", `rae-${suffix}@example.test`);
    const otherContactId = await insertContact(otherTenant.workspaceId, "Other Tenant", `other-${suffix}@example.test`);

    const widget = await createConversation({
      workspaceId: tenant.workspaceId,
      chatbotId: chatbot.id,
      contactId,
      channel: "widget",
      title: "Refund for order 42",
    });
    await appendMessage({
      workspaceId: tenant.workspaceId,
      conversationId: widget.id,
      role: "user",
      content: "Where is my refund for the espresso machine?",
    });
    await appendMessage({
      workspaceId: tenant.workspaceId,
      conversationId: widget.id,
      role: "assistant",
      content: "Refunds land within five working days.",
      sources: [{ id: "kc_1", title: "Refund policy", snippet: "Refunds are issued within five working days." }],
      usage: { inputTokens: 120, outputTokens: 40 },
    });
    await query("UPDATE conversations SET assigned_to = $3 WHERE workspace_id = $1 AND id = $2", [
      tenant.workspaceId,
      widget.id,
      ownerId,
    ]);

    const agentConversation = await createConversation({
      workspaceId: tenant.workspaceId,
      agentId: agent.id,
      channel: "agent",
      title: "Nightly sync failed",
    });
    await appendMessage({
      workspaceId: tenant.workspaceId,
      conversationId: agentConversation.id,
      role: "user",
      content: "The nightly inventory sync failed again.",
    });

    const otherTenantConversation = await createConversation({
      workspaceId: otherTenant.workspaceId,
      channel: "api",
      title: "Refund for order 99",
    });

    fixture = {
      ownerId,
      outsiderId,
      organizationId: tenant.organizationId,
      otherOrganizationId: otherTenant.organizationId,
      workspaceId: tenant.workspaceId,
      otherWorkspaceId: otherTenant.workspaceId,
      chatbotId: chatbot.id,
      agentId: agent.id,
      contactId,
      otherContactId,
      widgetConversationId: widget.id,
      agentConversationId: agentConversation.id,
      otherTenantConversationId: otherTenantConversation.id,
    };
  }, 60_000);

  afterAll(async () => {
    if (!hasDatabase) return;
    // Deleting the organizations cascades to workspaces, chatbots, agents,
    // contacts, conversations, messages and activity, leaving no rows behind.
    if (fixture?.organizationId) {
      await query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[fixture.organizationId, fixture.otherOrganizationId]]);
      await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[fixture.ownerId, fixture.outsiderId]]);
    }
    await getPool().end();
  });

  it("projects the joined chatbot, contact and assignee onto list rows", async () => {
    const page = await getConversations(fixture.workspaceId, { page: 1, pageSize: 20 }, fixture.ownerId);
    expect(page.total).toBe(2);

    const widget = page.items.find((item) => item.id === fixture.widgetConversationId);
    expect(widget?.source).toEqual({ type: "chatbot", id: fixture.chatbotId, name: "Support Bot" });
    expect(widget?.contact).toMatchObject({ id: fixture.contactId, name: "Rae Customer" });
    expect(widget?.assignee).toMatchObject({ id: fixture.ownerId, name: "Ada Owner" });
    expect(widget?.messageCount).toBe(2);
    expect(widget?.lastMessageAt).toEqual(expect.any(String));

    const agentRow = page.items.find((item) => item.id === fixture.agentConversationId);
    expect(agentRow?.source).toEqual({ type: "agent", id: fixture.agentId, name: "Ops Agent" });
    expect(agentRow?.contact).toBeNull();
    expect(agentRow?.assignee).toBeNull();
  });

  it("searches message bodies as well as titles without duplicating rows", async () => {
    const byTitle = await getConversations(fixture.workspaceId, { q: "refund for order" }, fixture.ownerId);
    expect(byTitle.items.map((item) => item.id)).toEqual([fixture.widgetConversationId]);

    const byBody = await getConversations(fixture.workspaceId, { q: "espresso" }, fixture.ownerId);
    expect(byBody.items.map((item) => item.id)).toEqual([fixture.widgetConversationId]);

    // "refund" appears in the title and in two messages of the same thread.
    const both = await getConversations(fixture.workspaceId, { q: "refund" }, fixture.ownerId);
    expect(both.total).toBe(1);
    expect(both.items).toHaveLength(1);
  });

  it("filters by chatbot, agent, channel and the caller's own assignments", async () => {
    const byChatbot = await getConversations(fixture.workspaceId, { chatbotId: fixture.chatbotId }, fixture.ownerId);
    expect(byChatbot.items.map((item) => item.id)).toEqual([fixture.widgetConversationId]);

    const byAgent = await getConversations(fixture.workspaceId, { agentId: fixture.agentId }, fixture.ownerId);
    expect(byAgent.items.map((item) => item.id)).toEqual([fixture.agentConversationId]);

    const byChannel = await getConversations(fixture.workspaceId, { channel: "agent" }, fixture.ownerId);
    expect(byChannel.items.map((item) => item.id)).toEqual([fixture.agentConversationId]);

    const mine = await getConversations(fixture.workspaceId, { assignedTo: "me" }, fixture.ownerId);
    expect(mine.items.map((item) => item.id)).toEqual([fixture.widgetConversationId]);

    // "me" is the caller, not a shared alias: another user's inbox is empty.
    const theirs = await getConversations(fixture.workspaceId, { assignedTo: "me" }, fixture.outsiderId);
    expect(theirs.items).toHaveLength(0);
  });

  it("never reaches across the workspace boundary", async () => {
    const page = await getConversations(fixture.workspaceId, { q: "refund" }, fixture.ownerId);
    expect(page.items.map((item) => item.id)).not.toContain(fixture.otherTenantConversationId);
    expect(await findConversationDetail(fixture.workspaceId, fixture.otherTenantConversationId)).toBeNull();
    await expect(getConversationDetail(fixture.workspaceId, fixture.otherTenantConversationId)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("returns messages oldest-first with their citations, usage and author", async () => {
    const detail = await getConversationDetail(fixture.workspaceId, fixture.widgetConversationId);
    expect(detail.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(detail.messages[0]?.sources).toBeNull();
    expect(detail.messages[1]?.sources).toEqual([
      { id: "kc_1", title: "Refund policy", snippet: "Refunds are issued within five working days." },
    ]);
    expect(detail.messages[1]?.usage).toEqual({ inputTokens: 120, outputTokens: 40 });
    expect(detail.messages[1]?.author).toBeNull();
  });

  it("rejects a contact or an assignee that does not belong to the workspace", async () => {
    const actor = { workspaceId: fixture.workspaceId, userId: fixture.ownerId, userName: "Ada Owner" };

    const foreignContact = await updateConversation(actor, fixture.agentConversationId, {
      contactId: fixture.otherContactId,
    }).catch((error: unknown) => error);
    expect(isApiError(foreignContact) && foreignContact.code).toBe("validation_error");

    const foreignAssignee = await updateConversation(actor, fixture.agentConversationId, {
      assignedTo: fixture.outsiderId,
    }).catch((error: unknown) => error);
    expect(isApiError(foreignAssignee) && foreignAssignee.code).toBe("validation_error");

    const unchanged = await findConversationDetail(fixture.workspaceId, fixture.agentConversationId);
    expect(unchanged?.contact).toBeNull();
    expect(unchanged?.assignee).toBeNull();
  });

  it("applies triage changes and records them in the activity log", async () => {
    const actor = { workspaceId: fixture.workspaceId, userId: fixture.ownerId, userName: "Ada Owner" };
    const updated = await updateConversation(actor, fixture.agentConversationId, {
      status: "escalated",
      assignedTo: fixture.ownerId,
      contactId: fixture.contactId,
    });

    expect(updated.status).toBe("escalated");
    expect(updated.assignee).toMatchObject({ id: fixture.ownerId });
    expect(updated.contact).toMatchObject({ id: fixture.contactId });

    const activity = await query<{ action: string }>(
      "SELECT action FROM activity_log WHERE workspace_id = $1 AND entity_id = $2 ORDER BY id",
      [fixture.workspaceId, fixture.agentConversationId],
    );
    expect(activity.map((entry) => entry.action)).toEqual(["status:escalated", "assigned", "contact_linked"]);
  });

  it("appends a team reply attributed to its author and moves the counters", async () => {
    const before = await findConversationDetail(fixture.workspaceId, fixture.widgetConversationId);
    const result = await replyToConversation(
      { workspaceId: fixture.workspaceId, userId: fixture.ownerId, userName: "Ada Owner" },
      fixture.widgetConversationId,
      { content: "I have escalated this to our payments team." },
    );

    expect(result.message.role).toBe("assistant");
    expect(result.message.author).toEqual({ id: fixture.ownerId, name: "Ada Owner" });
    expect(result.conversation.messageCount).toBe((before?.messageCount ?? 0) + 1);
    expect(result.conversation.lastMessageAt).not.toBe(before?.lastMessageAt);

    const messages = await listConversationMessages(fixture.workspaceId, fixture.widgetConversationId, 50);
    const stored = messages.at(-1);
    expect(stored?.author).toEqual({ id: fixture.ownerId, name: "Ada Owner" });
    expect(stored?.content).toBe("I have escalated this to our payments team.");
  });

  it("stores the AI recap under metadata.summary with the model that produced it", async () => {
    const conversation = await summarizeConversation(
      { workspaceId: fixture.workspaceId, userId: fixture.ownerId, userName: "Ada Owner" },
      fixture.widgetConversationId,
    );

    expect(conversation.summary?.text.length).toBeGreaterThan(0);
    expect(conversation.summary?.generatedBy).toBeTruthy();
    expect(conversation.summary?.messageCount).toBe(conversation.messageCount);
    expect(Number.isNaN(Date.parse(conversation.summary?.generatedAt ?? ""))).toBe(false);

    const stored = await queryOne<{ metadata: { summary?: { text: string; generatedBy: string | null } } }>(
      "SELECT metadata FROM conversations WHERE workspace_id = $1 AND id = $2",
      [fixture.workspaceId, fixture.widgetConversationId],
    );
    expect(stored?.metadata.summary?.text).toBe(conversation.summary?.text);

    // The recap is read back through the same validating mapper the UI uses.
    const reloaded = await findConversationDetail(fixture.workspaceId, fixture.widgetConversationId);
    expect(reloaded?.summary?.generatedBy).toBe(conversation.summary?.generatedBy);
    // The mock gateway streams token by token, so this test waits on a real
    // (simulated) model turn rather than a stub returning immediately.
  }, 30_000);
});
