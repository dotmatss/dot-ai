import "server-only";

import { describePropertyChange, describeTagChange, diffProperties, formatList, hasPropertyChange } from "@/features/crm/changes";
import { CONTACT_STAGE_META } from "@/features/crm/constants";
import { contactDisplayName, normalizeEmail, normalizeProperties, normalizeTags } from "@/features/crm/normalize";
import {
  deleteContactNoteRow,
  deleteContactRow,
  findContactById,
  findContactIdByEmail,
  findContactNoteOwner,
  insertContact,
  insertContactActivity,
  insertContactNote,
  listContactConversations,
  listContactNotes,
  listContacts,
  listContactTags,
  listContactTimeline,
  updateContactRow,
  type ContactPatch,
} from "@/features/crm/server/contact-repository";
import type {
  Contact,
  ContactConversation,
  ContactListFilters,
  ContactNote,
  ContactStage,
  ContactSummary,
  ContactTagCount,
  ContactTimelineEntry,
} from "@/features/crm/types";
import type { MemberRole } from "@/features/workspaces/roles";
import { canManage } from "@/features/workspaces/roles";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import type { WorkspaceContext } from "@/server/auth/dal";
import { withWorkspace, type Queryable } from "@/server/db/client";
import type { Paginated } from "@/types/pagination";

export interface ActorContext {
  workspaceId: string;
  userId: string;
  /**
   * Denormalized into contact activity metadata. `contact_activities` has no
   * actor column, and keeping the name with the event means the timeline still
   * reads correctly after the account is deleted.
   */
  actorName: string;
  role: MemberRole;
}

/** Builds the actor from a route handler's verified workspace context. */
export function contactActor(ctx: WorkspaceContext): ActorContext {
  return {
    workspaceId: ctx.membership.workspace.id,
    userId: ctx.user.id,
    actorName: ctx.user.name,
    role: ctx.membership.role,
  };
}

export interface ContactWriteInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  source?: string | null;
  stage?: ContactStage;
  tags?: string[];
  properties?: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export function getContacts(workspaceId: string, filters: ContactListFilters): Promise<Paginated<ContactSummary>> {
  return listContacts(workspaceId, filters);
}

export async function getContact(workspaceId: string, contactId: string): Promise<Contact> {
  const contact = await findContactById(workspaceId, contactId);
  if (!contact) throw ApiError.notFound("Contact not found");
  return contact;
}

export function getContactTags(workspaceId: string): Promise<ContactTagCount[]> {
  return listContactTags(workspaceId);
}

export async function getContactTimeline(
  workspaceId: string,
  contactId: string,
  page: { page?: number; pageSize?: number },
): Promise<Paginated<ContactTimelineEntry>> {
  await getContact(workspaceId, contactId);
  return listContactTimeline(workspaceId, contactId, page);
}

export async function getContactNotes(
  workspaceId: string,
  contactId: string,
  page: { page?: number; pageSize?: number },
): Promise<Paginated<ContactNote>> {
  await getContact(workspaceId, contactId);
  return listContactNotes(workspaceId, contactId, page);
}

export async function getContactConversations(
  workspaceId: string,
  contactId: string,
  page: { page?: number; pageSize?: number },
): Promise<Paginated<ContactConversation>> {
  await getContact(workspaceId, contactId);
  return listContactConversations(workspaceId, contactId, page);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Email is the contact's identity inside a workspace. The unique index would
 * reject a duplicate anyway, but a raw 23505 reaches the user as "a record with
 * the same unique value already exists"; this states which contact and which
 * field, and carries field details the form can attach to the email input.
 */
async function assertEmailAvailable(
  workspaceId: string,
  email: string | null,
  excludeContactId: string | null,
  client?: Queryable,
): Promise<void> {
  if (!email) return;
  const existingId = await findContactIdByEmail(workspaceId, email, client);
  if (!existingId || existingId === excludeContactId) return;
  throw new ApiError("conflict", `${email} is already on another contact in this workspace`, {
    email: ["This email address is already used by another contact"],
  });
}

export async function createContact(ctx: ActorContext, input: ContactWriteInput): Promise<Contact> {
  const email = normalizeEmail(input.email);
  const name = input.name?.trim() || null;
  if (!name && !email) {
    throw ApiError.validation({ name: ["Enter a name or an email address"] });
  }

  return withWorkspace(ctx.workspaceId, async (client) => {
    await assertEmailAvailable(ctx.workspaceId, email, null, client);

    const contactId = await insertContact(
      {
        workspaceId: ctx.workspaceId,
        name,
        email,
        phone: input.phone?.trim() || null,
        company: input.company?.trim() || null,
        source: input.source?.trim() || null,
        stage: input.stage ?? "lead",
        tags: normalizeTags(input.tags),
        properties: normalizeProperties(input.properties),
      },
      client,
    );

    const contact = await findContactById(ctx.workspaceId, contactId, client);
    if (!contact) throw new Error("Contact vanished after insert");

    await insertContactActivity(
      {
        workspaceId: ctx.workspaceId,
        contactId,
        type: "created",
        description: `Contact created as ${CONTACT_STAGE_META[contact.stage].label.toLowerCase()}`,
        metadata: { actorId: ctx.userId, actorName: ctx.actorName, stage: contact.stage },
      },
      client,
    );
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "contact",
        entityId: contactId,
        action: "created",
        summary: `Created contact “${contactDisplayName(contact)}”`,
      },
      client,
    );
    return contact;
  });
}

const TRACKED_FIELD_LABELS: Record<string, string> = {
  name: "name",
  email: "email",
  phone: "phone",
  company: "company",
  source: "source",
};

export async function updateContact(ctx: ActorContext, contactId: string, input: ContactWriteInput): Promise<Contact> {
  return withWorkspace(ctx.workspaceId, async (client) => {
    const existing = await findContactById(ctx.workspaceId, contactId, client);
    if (!existing) throw ApiError.notFound("Contact not found");

    const patch: ContactPatch = {};
    if (input.name !== undefined) patch.name = input.name?.trim() || null;
    if (input.email !== undefined) patch.email = normalizeEmail(input.email);
    if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
    if (input.company !== undefined) patch.company = input.company?.trim() || null;
    if (input.source !== undefined) patch.source = input.source?.trim() || null;
    if (input.stage !== undefined) patch.stage = input.stage;
    if (input.tags !== undefined) patch.tags = normalizeTags(input.tags);
    if (input.properties !== undefined) patch.properties = normalizeProperties(input.properties);

    const nextName = patch.name !== undefined ? patch.name : existing.name;
    const nextEmail = patch.email !== undefined ? patch.email : existing.email;
    if (!nextName && !nextEmail) {
      throw ApiError.validation({ name: ["Enter a name or an email address"] });
    }
    if (patch.email !== undefined) {
      await assertEmailAvailable(ctx.workspaceId, patch.email, contactId, client);
    }

    await updateContactRow(ctx.workspaceId, contactId, patch, client);
    const updated = await findContactById(ctx.workspaceId, contactId, client);
    if (!updated) throw ApiError.notFound("Contact not found");

    await recordContactChanges(ctx, existing, updated, patch, client);
    return updated;
  });
}

/**
 * Stage, tag and property changes each get their own timeline entry: they are
 * the events a salesperson looks for, and burying them in a generic "updated"
 * row would make the history useless.
 */
async function recordContactChanges(
  ctx: ActorContext,
  before: Contact,
  after: Contact,
  patch: ContactPatch,
  client: Queryable,
): Promise<void> {
  const actor = { actorId: ctx.userId, actorName: ctx.actorName };
  const changedLabels: string[] = [];

  for (const field of Object.keys(TRACKED_FIELD_LABELS)) {
    const key = field as keyof ContactPatch;
    if (patch[key] === undefined) continue;
    if (before[key as keyof Contact] === after[key as keyof Contact]) continue;
    changedLabels.push(TRACKED_FIELD_LABELS[field] ?? field);
  }

  const stageChanged = patch.stage !== undefined && before.stage !== after.stage;
  let recorded = false;

  if (stageChanged) {
    recorded = true;
    await insertContactActivity(
      {
        workspaceId: ctx.workspaceId,
        contactId: after.id,
        type: "stage_changed",
        description: `Stage changed from ${CONTACT_STAGE_META[before.stage].label} to ${CONTACT_STAGE_META[after.stage].label}`,
        metadata: { ...actor, from: before.stage, to: after.stage },
      },
      client,
    );
  }

  if (patch.tags !== undefined) {
    const added = after.tags.filter((tag) => !before.tags.includes(tag));
    const removed = before.tags.filter((tag) => !after.tags.includes(tag));
    if (added.length > 0 || removed.length > 0) {
      recorded = true;
      await insertContactActivity(
        {
          workspaceId: ctx.workspaceId,
          contactId: after.id,
          type: "tags_changed",
          description: describeTagChange(added, removed),
          metadata: { ...actor, added, removed },
        },
        client,
      );
    }
  }

  if (patch.properties !== undefined) {
    const change = diffProperties(before.properties, after.properties);
    if (hasPropertyChange(change)) {
      recorded = true;
      await insertContactActivity(
        {
          workspaceId: ctx.workspaceId,
          contactId: after.id,
          type: "properties_changed",
          description: describePropertyChange(change),
          metadata: { ...actor, ...change },
        },
        client,
      );
    }
  }

  if (changedLabels.length > 0) {
    recorded = true;
    await insertContactActivity(
      {
        workspaceId: ctx.workspaceId,
        contactId: after.id,
        type: "updated",
        description: `Updated ${formatList(changedLabels)}`,
        metadata: { ...actor, fields: changedLabels },
      },
      client,
    );
  }

  // Saving a form without touching anything is not an event: keep the
  // workspace feed to changes that actually happened.
  if (!recorded) return;

  await recordActivity(
    {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      entityType: "contact",
      entityId: after.id,
      action: stageChanged ? `stage:${after.stage}` : "updated",
      summary: `Updated contact “${contactDisplayName(after)}”`,
      metadata: { fields: Object.keys(patch) },
    },
    client,
  );
}

export async function deleteContact(ctx: ActorContext, contactId: string): Promise<void> {
  const existing = await findContactById(ctx.workspaceId, contactId);
  if (!existing) throw ApiError.notFound("Contact not found");
  await deleteContactRow(ctx.workspaceId, contactId);
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "contact",
    entityId: contactId,
    action: "deleted",
    summary: `Deleted contact “${contactDisplayName(existing)}”`,
  });
}

/* -------------------------------------------------------------------------- */
/* Notes                                                                       */
/* -------------------------------------------------------------------------- */

export async function addContactNote(ctx: ActorContext, contactId: string, body: string): Promise<ContactNote> {
  return withWorkspace(ctx.workspaceId, async (client) => {
    const contact = await findContactById(ctx.workspaceId, contactId, client);
    if (!contact) throw ApiError.notFound("Contact not found");
    // Notes appear in the timeline as themselves, so no separate activity row
    // is written: that would show the same event twice.
    const note = await insertContactNote({ workspaceId: ctx.workspaceId, contactId, authorId: ctx.userId, body }, client);
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "contact",
        entityId: contactId,
        action: "note_added",
        summary: `Added a note to “${contactDisplayName(contact)}”`,
      },
      client,
    );
    return note;
  });
}

/** Authors may remove their own notes; admins may remove any. */
export async function deleteContactNote(ctx: ActorContext, contactId: string, noteId: string): Promise<void> {
  await withWorkspace(ctx.workspaceId, async (client) => {
    const note = await findContactNoteOwner(ctx.workspaceId, contactId, noteId, client);
    if (!note) throw ApiError.notFound("Note not found");
    if (note.authorId !== ctx.userId && !canManage(ctx.role)) {
      throw ApiError.forbidden("Only the author or an admin can delete this note");
    }
    await deleteContactNoteRow(ctx.workspaceId, contactId, noteId, client);
  });
}

/* -------------------------------------------------------------------------- */
/* Lead capture                                                                */
/* -------------------------------------------------------------------------- */

export interface UpsertContactByEmailInput {
  email: string;
  name?: string | null;
  source?: string | null;
  stage?: ContactStage;
}

/**
 * Creates or refreshes a contact from an email address.
 *
 * This is the seam chatbots, agents and workflows use to capture a lead, so
 * the identity rules live here once: the email is normalized, matched
 * per workspace, and an existing contact is enriched rather than overwritten -
 * a name typed by a visitor never replaces one a salesperson curated, and the
 * stage only moves while the contact is still an unqualified `lead`.
 * `last_seen_at` is always bumped, which is the point of the call.
 */
export async function upsertContactByEmail(workspaceId: string, input: UpsertContactByEmailInput): Promise<Contact> {
  const email = normalizeEmail(input.email);
  if (!email) throw ApiError.validation({ email: ["Enter a valid email address"] });

  return withWorkspace(workspaceId, async (client) => {
    const existingId = await findContactIdByEmail(workspaceId, email, client);
    const name = input.name?.trim() || null;
    const source = input.source?.trim() || null;
    const now = new Date();

    if (!existingId) {
      const contactId = await insertContact(
        {
          workspaceId,
          name,
          email,
          phone: null,
          company: null,
          source,
          stage: input.stage ?? "lead",
          tags: [],
          properties: {},
          lastSeenAt: now,
        },
        client,
      );
      const created = await findContactById(workspaceId, contactId, client);
      if (!created) throw new Error("Contact vanished after insert");
      await insertContactActivity(
        {
          workspaceId,
          contactId,
          type: "created",
          description: source ? `Captured from ${source}` : "Captured automatically",
          metadata: { source, stage: created.stage },
        },
        client,
      );
      await recordActivity(
        {
          workspaceId,
          actorId: null,
          entityType: "contact",
          entityId: contactId,
          action: "created",
          summary: `Captured contact “${contactDisplayName(created)}”`,
          metadata: { source },
        },
        client,
      );
      return created;
    }

    const existing = await findContactById(workspaceId, existingId, client);
    if (!existing) throw new Error("Contact vanished during upsert");

    const patch: ContactPatch = { lastSeenAt: now };
    if (!existing.name && name) patch.name = name;
    if (!existing.source && source) patch.source = source;
    if (input.stage && input.stage !== existing.stage && existing.stage === "lead") patch.stage = input.stage;

    await updateContactRow(workspaceId, existingId, patch, client);

    if (patch.stage) {
      await insertContactActivity(
        {
          workspaceId,
          contactId: existingId,
          type: "stage_changed",
          description: `Stage changed from ${CONTACT_STAGE_META[existing.stage].label} to ${CONTACT_STAGE_META[patch.stage].label}`,
          metadata: { from: existing.stage, to: patch.stage, source },
        },
        client,
      );
    }

    const updated = await findContactById(workspaceId, existingId, client);
    if (!updated) throw new Error("Contact vanished during upsert");
    return updated;
  });
}
