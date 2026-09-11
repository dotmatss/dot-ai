// @vitest-environment node
/**
 * Integration test for the CRM against real PostgreSQL: identity rules (email
 * normalization and per-workspace uniqueness), the activity trail that stage,
 * tag and property edits leave behind, the merged timeline, note permissions,
 * tenant isolation, the tag facet and the stored AI summary.
 *
 * Skipped automatically when DATABASE_URL is not configured, so the suite still
 * runs on a machine without a database:
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/dot_dev" node scripts/verify.mjs --tests crm
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addContactNote,
  createContact,
  deleteContactNote,
  getContact,
  getContactConversations,
  getContactNotes,
  getContactTags,
  getContactTimeline,
  updateContact,
  upsertContactByEmail,
  type ActorContext,
} from "@/features/crm/server/contact-service";
import { generateContactSummary } from "@/features/crm/server/contact-summary";
import { isApiError } from "@/lib/api/api-error";
import { query, queryOne } from "@/server/db/client";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suffix = Math.random().toString(36).slice(2, 10);

interface Fixture {
  ownerId: string;
  memberId: string;
  organizationId: string;
  otherOrganizationId: string;
  workspaceId: string;
  otherWorkspaceId: string;
  chatbotId: string;
}

let fixture: Fixture;
let owner: ActorContext;
let member: ActorContext;

async function insertUser(email: string, name: string): Promise<string> {
  const row = await queryOne<{ id: string }>("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id", [email, name]);
  if (!row) throw new Error("failed to insert user");
  return row.id;
}

async function insertTenant(label: string, ownerId: string): Promise<{ organizationId: string; workspaceId: string }> {
  const organization = await queryOne<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [
    `CRM ${label} ${suffix}`,
    `crm-${label}-${suffix}`,
  ]);
  if (!organization) throw new Error("failed to insert organization");
  await query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [organization.id, ownerId]);
  const workspace = await queryOne<{ id: string }>(
    "INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
    [organization.id, `CRM WS ${label} ${suffix}`, `crm-ws-${label}-${suffix}`],
  );
  if (!workspace) throw new Error("failed to insert workspace");
  return { organizationId: organization.id, workspaceId: workspace.id };
}

describe.skipIf(!hasDatabase)("CRM persistence (PostgreSQL)", () => {
  beforeAll(async () => {
    const ownerId = await insertUser(`crm-owner-${suffix}@example.test`, "Ada Owner");
    const memberId = await insertUser(`crm-member-${suffix}@example.test`, "Grace Member");
    const tenant = await insertTenant("a", ownerId);
    const otherTenant = await insertTenant("b", memberId);
    const chatbot = await queryOne<{ id: string }>(
      `INSERT INTO chatbots (workspace_id, created_by, name, slug, embed_key) VALUES ($1, $2, 'Support Bot', $3, $4) RETURNING id`,
      [tenant.workspaceId, ownerId, `crm-support-${suffix}`, `cb_crm_${suffix}`],
    );
    if (!chatbot) throw new Error("failed to insert fixture chatbot");

    fixture = {
      ownerId,
      memberId,
      organizationId: tenant.organizationId,
      otherOrganizationId: otherTenant.organizationId,
      workspaceId: tenant.workspaceId,
      otherWorkspaceId: otherTenant.workspaceId,
      chatbotId: chatbot.id,
    };
    owner = { workspaceId: tenant.workspaceId, userId: ownerId, actorName: "Ada Owner", role: "owner" };
    member = { workspaceId: tenant.workspaceId, userId: memberId, actorName: "Grace Member", role: "member" };
  });

  afterAll(async () => {
    if (!hasDatabase || !fixture) return;
    await query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[fixture.organizationId, fixture.otherOrganizationId]]);
    await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[fixture.ownerId, fixture.memberId]]);
  });

  it("normalizes identity fields on create and records a creation activity", async () => {
    const contact = await createContact(owner, {
      name: "  Rae Customer  ",
      email: "  Rae@Example.TEST ",
      company: " Acme ",
      stage: "prospect",
      tags: [" VIP ", "vip", "Beta"],
    });

    expect(contact.name).toBe("Rae Customer");
    expect(contact.email).toBe("rae@example.test");
    expect(contact.company).toBe("Acme");
    expect(contact.tags).toEqual(["vip", "beta"]);

    const timeline = await getContactTimeline(fixture.workspaceId, contact.id, { page: 1 });
    expect(timeline.items[0]).toMatchObject({ kind: "activity", type: "created", actorName: "Ada Owner" });
  });

  it("rejects a duplicate email with a 409 that names the field", async () => {
    await createContact(owner, { name: "First", email: `dupe-${suffix}@example.test` });
    try {
      await createContact(owner, { name: "Second", email: `DUPE-${suffix}@Example.test` });
      throw new Error("expected a conflict");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (!isApiError(error)) return;
      expect(error.code).toBe("conflict");
      expect(error.details?.email?.[0]).toContain("already used");
    }
  });

  it("allows the same email in another workspace", async () => {
    const other: ActorContext = { workspaceId: fixture.otherWorkspaceId, userId: fixture.memberId, actorName: "Grace Member", role: "owner" };
    const contact = await createContact(other, { name: "Shared", email: `dupe-${suffix}@example.test` });
    expect(contact.workspaceId).toBe(fixture.otherWorkspaceId);
  });

  it("records stage, tag and property changes as separate timeline entries", async () => {
    const contact = await createContact(owner, { name: "Timeline Target", email: `timeline-${suffix}@example.test` });

    await updateContact(owner, contact.id, { stage: "customer" });
    await updateContact(owner, contact.id, { tags: ["vip"] });
    await updateContact(owner, contact.id, { properties: { plan: "pro" } });
    await updateContact(owner, contact.id, { properties: { plan: "enterprise" } });
    await updateContact(owner, contact.id, { company: "Globex" });

    const timeline = await getContactTimeline(fixture.workspaceId, contact.id, { page: 1, pageSize: 50 });
    const types = timeline.items.map((entry) => entry.type);
    expect(types).toContain("stage_changed");
    expect(types).toContain("tags_changed");
    expect(types).toContain("properties_changed");
    expect(types).toContain("updated");

    const stageEntry = timeline.items.find((entry) => entry.type === "stage_changed");
    expect(stageEntry?.title).toBe("Stage changed from Lead to Customer");
    expect(stageEntry?.metadata).toMatchObject({ from: "lead", to: "customer" });

    const propertyEntries = timeline.items.filter((entry) => entry.type === "properties_changed");
    expect(propertyEntries.map((entry) => entry.title)).toEqual(
      expect.arrayContaining(["Properties added plan", "Properties changed plan"]),
    );

    // Newest first, and every entry carries the actor that caused it.
    const timestamps = timeline.items.map((entry) => Date.parse(entry.createdAt));
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
    expect(timeline.items.every((entry) => entry.actorName === "Ada Owner")).toBe(true);
  });

  it("writes no activity when a save changes nothing", async () => {
    const contact = await createContact(owner, { name: "Idempotent", email: `idem-${suffix}@example.test` });
    const before = await getContactTimeline(fixture.workspaceId, contact.id, { page: 1 });
    await updateContact(owner, contact.id, { name: "Idempotent", stage: "lead" });
    const after = await getContactTimeline(fixture.workspaceId, contact.id, { page: 1 });
    expect(after.total).toBe(before.total);
  });

  it("refuses to leave a contact with neither a name nor an email", async () => {
    const contact = await createContact(owner, { name: "Nameless Soon", email: `nameless-${suffix}@example.test` });
    await expect(updateContact(owner, contact.id, { name: null, email: null })).rejects.toMatchObject({ code: "validation_error" });
  });

  it("merges notes and conversations into the timeline and lists them per tab", async () => {
    const contact = await createContact(owner, { name: "Merged", email: `merged-${suffix}@example.test` });
    await addContactNote(member, contact.id, "Wants a demo next week.");

    const conversation = await queryOne<{ id: string }>(
      `INSERT INTO conversations (workspace_id, chatbot_id, contact_id, title, message_count, last_message_at)
       VALUES ($1, $2, $3, 'Pricing question', 2, now()) RETURNING id`,
      [fixture.workspaceId, fixture.chatbotId, contact.id],
    );
    if (!conversation) throw new Error("failed to insert conversation");

    const timeline = await getContactTimeline(fixture.workspaceId, contact.id, { page: 1 });
    const kinds = timeline.items.map((entry) => entry.kind);
    expect(kinds).toContain("note");
    expect(kinds).toContain("conversation");

    const note = timeline.items.find((entry) => entry.kind === "note");
    expect(note?.body).toBe("Wants a demo next week.");
    expect(note?.actorName).toBe("Grace Member");

    const conversationEntry = timeline.items.find((entry) => entry.kind === "conversation");
    expect(conversationEntry?.refId).toBe(conversation.id);
    expect(conversationEntry?.metadata).toMatchObject({ status: "open", channel: "widget", messageCount: 2 });

    const conversations = await getContactConversations(fixture.workspaceId, contact.id, { page: 1 });
    expect(conversations.items[0]).toMatchObject({ id: conversation.id, sourceName: "Support Bot", messageCount: 2 });

    const reloaded = await getContact(fixture.workspaceId, contact.id);
    expect(reloaded.noteCount).toBe(1);
    expect(reloaded.conversationCount).toBe(1);
  });

  it("lets an author delete their own note and refuses another member's", async () => {
    const contact = await createContact(owner, { name: "Notes", email: `notes-${suffix}@example.test` });
    const mine = await addContactNote(member, contact.id, "Mine to delete.");
    const theirs = await addContactNote(owner, contact.id, "Owner's note.");

    await deleteContactNote(member, contact.id, mine.id);
    await expect(deleteContactNote(member, contact.id, theirs.id)).rejects.toMatchObject({ code: "forbidden" });
    // An admin may remove any note.
    await deleteContactNote(owner, contact.id, theirs.id);

    const notes = await getContactNotes(fixture.workspaceId, contact.id, { page: 1 });
    expect(notes.total).toBe(0);
  });

  it("keeps every read scoped to its workspace", async () => {
    const contact = await createContact(owner, { name: "Tenant A", email: `tenant-a-${suffix}@example.test` });
    await expect(getContact(fixture.otherWorkspaceId, contact.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(getContactTimeline(fixture.otherWorkspaceId, contact.id, { page: 1 })).rejects.toMatchObject({ code: "not_found" });
    await expect(updateContact({ ...owner, workspaceId: fixture.otherWorkspaceId }, contact.id, { stage: "churned" })).rejects.toMatchObject(
      { code: "not_found" },
    );
  });

  it("counts distinct tags for the filter facet", async () => {
    const tags = await getContactTags(fixture.workspaceId);
    const vip = tags.find((tag) => tag.tag === "vip");
    expect(vip?.count).toBeGreaterThanOrEqual(2);
    expect(tags.every((tag) => tag.tag === tag.tag.toLowerCase())).toBe(true);
  });

  describe("upsertContactByEmail", () => {
    it("creates a capture with its source and marks it seen", async () => {
      const email = `capture-${suffix}@example.test`;
      const created = await upsertContactByEmail(fixture.workspaceId, { email: ` ${email.toUpperCase()} `, name: "Web Visitor", source: "widget" });
      expect(created.email).toBe(email);
      expect(created.source).toBe("widget");
      expect(created.stage).toBe("lead");
      expect(created.lastSeenAt).not.toBeNull();
    });

    it("enriches without overwriting curated fields and only advances a lead", async () => {
      const email = `enrich-${suffix}@example.test`;
      const first = await upsertContactByEmail(fixture.workspaceId, { email, name: "Typed By Visitor", source: "widget" });
      const seenAt = first.lastSeenAt;

      const second = await upsertContactByEmail(fixture.workspaceId, { email, name: "Different Name", source: "api", stage: "prospect" });
      expect(second.id).toBe(first.id);
      expect(second.name).toBe("Typed By Visitor");
      expect(second.source).toBe("widget");
      expect(second.stage).toBe("prospect");
      expect(Date.parse(second.lastSeenAt ?? "")).toBeGreaterThanOrEqual(Date.parse(seenAt ?? ""));

      // A curated stage is never rolled back by an automated capture.
      const third = await upsertContactByEmail(fixture.workspaceId, { email, stage: "lead" });
      expect(third.stage).toBe("prospect");
    });

    it("fills a blank name left by an earlier capture", async () => {
      const email = `blank-${suffix}@example.test`;
      await upsertContactByEmail(fixture.workspaceId, { email });
      const enriched = await upsertContactByEmail(fixture.workspaceId, { email, name: "Known Later" });
      expect(enriched.name).toBe("Known Later");
    });
  });

  it(
    "stores an AI summary generated from notes and conversation messages",
    async () => {
      const contact = await createContact(owner, { name: "Summary Target", email: `summary-${suffix}@example.test` });
      await expect(generateContactSummary(owner, contact.id)).rejects.toMatchObject({ code: "bad_request" });

      await addContactNote(owner, contact.id, "Evaluating the enterprise plan for 40 seats.");
      const conversation = await queryOne<{ id: string }>(
        `INSERT INTO conversations (workspace_id, chatbot_id, contact_id, title, message_count, last_message_at)
         VALUES ($1, $2, $3, 'Seats', 1, now()) RETURNING id`,
        [fixture.workspaceId, fixture.chatbotId, contact.id],
      );
      if (!conversation) throw new Error("failed to insert conversation");
      await query("INSERT INTO messages (workspace_id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)", [
        fixture.workspaceId,
        conversation.id,
        "Do you offer annual billing?",
      ]);

      const summarized = await generateContactSummary(owner, contact.id);
      expect(summarized.aiSummary && summarized.aiSummary.length).toBeGreaterThan(0);

      const stored = await queryOne<{ ai_summary: string | null }>("SELECT ai_summary FROM contacts WHERE workspace_id = $1 AND id = $2", [
        fixture.workspaceId,
        contact.id,
      ]);
      expect(stored?.ai_summary).toBe(summarized.aiSummary);

      const timeline = await getContactTimeline(fixture.workspaceId, contact.id, { page: 1 });
      expect(timeline.items.some((entry) => entry.type === "summary_generated")).toBe(true);

      const usage = await queryOne<{ count: string }>(
        "SELECT count(*) AS count FROM usage_events WHERE workspace_id = $1 AND ref_type = 'contact' AND ref_id = $2",
        [fixture.workspaceId, contact.id],
      );
      expect(Number(usage?.count ?? 0)).toBeGreaterThan(0);
      // The mock gateway streams token by token, so this waits on a real
      // (simulated) model turn rather than a stub returning immediately.
    },
    30_000,
  );
});
