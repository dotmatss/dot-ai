import "server-only";

import { and, arrayContains, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";

import { TAG_FACET_LIMIT } from "@/features/crm/constants";
import { normalizeProperties } from "@/features/crm/normalize";
import type { SummaryMaterial } from "@/features/crm/summary-prompt";
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
import { query, queryOne, withDb, type DatabaseClient } from "@/server/db/client";
import {
  agents,
  chatbots,
  contactActivities,
  contactNotes,
  contacts,
  conversations,
  messages,
  users,
} from "@/server/db/schema";
import { likePattern, normalizePage, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

/** Connection-less builder, used only to COMPOSE correlated subqueries. */
const qb = new QueryBuilder();

/**
 * All CRM persistence. Every statement filters on `workspace_id` explicitly;
 * RLS is the second line of defence, not the first.
 *
 * Two reads stay hand-written SQL, each for a shape the builder has no
 * vocabulary for, and both are noted where they appear: the tag facet, which
 * calls a set-returning function in its FROM clause, and the timeline, which is
 * a three-branch UNION ALL with per-column type coercion.
 */

interface ContactRow {
  id: string;
  workspaceId: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  company: string | null;
  stage: ContactStage;
  source: string | null;
  tags: string[] | null;
  properties: unknown;
  aiSummary: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ContactDetailRow extends ContactRow {
  noteCount: number;
  conversationCount: number;
  activityCount: number;
}

const contactColumns = {
  id: contacts.id,
  workspaceId: contacts.workspaceId,
  email: contacts.email,
  name: contacts.name,
  phone: contacts.phone,
  company: contacts.company,
  stage: contacts.stage,
  source: contacts.source,
  tags: contacts.tags,
  properties: contacts.properties,
  aiSummary: contacts.aiSummary,
  lastSeenAt: contacts.lastSeenAt,
  createdAt: contacts.createdAt,
  updatedAt: contacts.updatedAt,
};

/**
 * The three counters are correlated subqueries rather than joins: joining all
 * three would multiply the rows and make every count wrong. Each one repeats
 * the workspace predicate so a mislinked child row cannot be counted.
 *
 * Each is COMPOSED with the query builder rather than written as one `sql`
 * template, and that is load-bearing. In a select list with no join, Drizzle
 * renders an interpolated column without its table name, so a hand-written
 * template would emit `WHERE "contact_id" = "id"` - two columns of the INNER
 * table, which counts nothing. Composed this way the references stay qualified.
 */
const countFor = (child: typeof contactNotes | typeof conversations | typeof contactActivities) =>
  sql<number>`${qb
    .select({ c: sql`count(*)` })
    .from(child)
    .where(and(eq(child.workspaceId, contacts.workspaceId), eq(child.contactId, contacts.id)))}`.mapWith(Number);

const contactDetailColumns = {
  ...contactColumns,
  noteCount: countFor(contactNotes),
  conversationCount: countFor(conversations),
  activityCount: countFor(contactActivities),
};

function mapSummary(row: ContactRow): ContactSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    stage: row.stage,
    source: row.source,
    tags: row.tags ?? [],
    lastSeenAt: toIso(row.lastSeenAt),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

function mapContact(row: ContactDetailRow): Contact {
  return {
    ...mapSummary(row),
    workspaceId: row.workspaceId,
    properties: normalizeProperties(row.properties as Record<string, unknown> | null),
    aiSummary: row.aiSummary,
    noteCount: Number(row.noteCount ?? 0),
    conversationCount: Number(row.conversationCount ?? 0),
    activityCount: Number(row.activityCount ?? 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Contacts                                                                    */
/* -------------------------------------------------------------------------- */

export async function listContacts(workspaceId: string, filters: ContactListFilters): Promise<Paginated<ContactSummary>> {
  const page = normalizePage(filters);

  const conditions: Array<SQL | undefined> = [eq(contacts.workspaceId, workspaceId)];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conditions.push(
      or(
        ilike(contacts.name, pattern),
        // `email` is citext, which has no ILIKE operator of its own. The cast
        // is what makes the pattern match resolve, as it did before.
        sql`${contacts.email}::text ILIKE ${pattern}`,
        ilike(contacts.company, pattern),
      ),
    );
  }
  if (filters.stage) conditions.push(eq(contacts.stage, filters.stage));
  // Containment (rather than = ANY) is what the GIN index on tags serves.
  if (filters.tag) conditions.push(arrayContains(contacts.tags, [filters.tag]));
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db
        .select(contactColumns)
        .from(contacts)
        .where(where)
        .orderBy(desc(contacts.createdAt), desc(contacts.id))
        .limit(page.pageSize)
        .offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(contacts).where(where)),
  ]);

  return toPaginated(rows.map(mapSummary), totals[0]?.total ?? 0, page);
}

export async function findContactById(workspaceId: string, contactId: string, client?: DatabaseClient): Promise<Contact | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(contactDetailColumns)
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)))
        .limit(1),
    client,
  );
  return rows[0] ? mapContact(rows[0]) : null;
}

/** Identity lookup for the per-workspace email uniqueness rule and for upserts. */
export async function findContactIdByEmail(
  workspaceId: string,
  email: string,
  client?: DatabaseClient,
): Promise<string | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({ id: contacts.id })
        .from(contacts)
        // citext equality: the case-insensitive comparison happens in the database.
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.email, email)))
        .limit(1),
    client,
  );
  return rows[0]?.id ?? null;
}

export interface InsertContactInput {
  workspaceId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  stage: ContactStage;
  tags: string[];
  properties: Record<string, string>;
  lastSeenAt?: Date | null;
}

export async function insertContact(input: InsertContactInput, client?: DatabaseClient): Promise<string> {
  const rows = await withDb(
    (db) =>
      db
        .insert(contacts)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          company: input.company,
          source: input.source,
          stage: input.stage,
          tags: input.tags,
          properties: input.properties,
          lastSeenAt: input.lastSeenAt ?? null,
        })
        .returning({ id: contacts.id }),
    client,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Failed to insert contact");
  return id;
}

export interface ContactPatch {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  source?: string | null;
  stage?: ContactStage;
  tags?: string[];
  properties?: Record<string, string>;
  aiSummary?: string | null;
  lastSeenAt?: Date | null;
}

export async function updateContactRow(
  workspaceId: string,
  contactId: string,
  patch: ContactPatch,
  client?: DatabaseClient,
): Promise<void> {
  // Only the keys actually present are written, so an absent field keeps its
  // stored value instead of being overwritten with undefined.
  const values: Partial<typeof contacts.$inferInsert> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.email !== undefined) values.email = patch.email;
  if (patch.phone !== undefined) values.phone = patch.phone;
  if (patch.company !== undefined) values.company = patch.company;
  if (patch.source !== undefined) values.source = patch.source;
  if (patch.stage !== undefined) values.stage = patch.stage;
  if (patch.tags !== undefined) values.tags = patch.tags;
  if (patch.properties !== undefined) values.properties = patch.properties;
  if (patch.aiSummary !== undefined) values.aiSummary = patch.aiSummary;
  if (patch.lastSeenAt !== undefined) values.lastSeenAt = patch.lastSeenAt;
  if (Object.keys(values).length === 0) return;

  await withDb(
    (db) => db.update(contacts).set(values).where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId))),
    client,
  );
}

export async function deleteContactRow(workspaceId: string, contactId: string): Promise<boolean> {
  const rows = await withDb((db) =>
    db
      .delete(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)))
      .returning({ id: contacts.id }),
  );
  return rows.length > 0;
}

/**
 * Distinct tags with usage counts, powering the tag filter facet.
 *
 * Raw SQL, and the one thing that makes it so is `unnest(c.tags)` in the FROM
 * clause: expanding an array column into rows is a set-returning function, and
 * Drizzle's `from()` takes a table or a subquery, not a lateral function call.
 * Everything else here is an ordinary GROUP BY over the result.
 */
export async function listContactTags(workspaceId: string): Promise<ContactTagCount[]> {
  const rows = await query<{ tag: string; count: string }>(
    `SELECT tag, count(*) AS count
     FROM contacts c, unnest(c.tags) AS tag
     WHERE c.workspace_id = $1
     GROUP BY tag
     ORDER BY count(*) DESC, tag ASC
     LIMIT $2`,
    [workspaceId, TAG_FACET_LIMIT],
  );
  return rows.map((row) => ({ tag: row.tag, count: Number(row.count) }));
}

/* -------------------------------------------------------------------------- */
/* Activities                                                                  */
/* -------------------------------------------------------------------------- */

export interface InsertContactActivityInput {
  workspaceId: string;
  contactId: string;
  type: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export async function insertContactActivity(input: InsertContactActivityInput, client?: DatabaseClient): Promise<void> {
  await withDb(
    (db) =>
      db.insert(contactActivities).values({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        type: input.type,
        description: input.description,
        metadata: input.metadata ?? {},
      }),
    client,
  );
}

/**
 * The merged history. Notes and conversations are events in their own right,
 * so they are unioned with the recorded activities rather than fetched
 * separately and stitched together in JavaScript, which would make pagination
 * across the three sources incorrect.
 *
 * Raw SQL, deliberately. The shape is a three-branch UNION ALL in which every
 * branch has to coerce its columns to one common type (`NULL::text`,
 * `NULL::uuid`, `'{}'::jsonb`) so the branches line up. Expressed through the
 * builder, nearly every column would become a `sql` fragment anyway - more code
 * producing the same string, and the string is the part worth reading.
 */
const TIMELINE_SOURCE = `
  SELECT 'activity'::text AS kind,
         a.id::text AS entry_id,
         a.type::text AS type,
         a.description::text AS title,
         NULL::text AS body,
         a.metadata AS metadata,
         NULL::uuid AS author_id,
         NULL::uuid AS ref_id,
         a.created_at AS created_at
  FROM contact_activities a
  WHERE a.workspace_id = $1 AND a.contact_id = $2
  UNION ALL
  SELECT 'note'::text,
         n.id::text,
         'note'::text,
         'Note added'::text,
         n.body::text,
         '{}'::jsonb,
         n.author_id,
         NULL::uuid,
         n.created_at
  FROM contact_notes n
  WHERE n.workspace_id = $1 AND n.contact_id = $2
  UNION ALL
  SELECT 'conversation'::text,
         cv.id::text,
         'conversation'::text,
         coalesce(nullif(cv.title, ''), 'Conversation')::text,
         NULL::text,
         jsonb_build_object('status', cv.status::text, 'channel', cv.channel::text, 'messageCount', cv.message_count),
         NULL::uuid,
         cv.id,
         coalesce(cv.last_message_at, cv.created_at)
  FROM conversations cv
  WHERE cv.workspace_id = $1 AND cv.contact_id = $2
`;

interface TimelineRow {
  kind: "activity" | "note" | "conversation";
  entry_id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  ref_id: string | null;
  author_name: string | null;
  created_at: Date;
}

export async function listContactTimeline(
  workspaceId: string,
  contactId: string,
  input: { page?: number; pageSize?: number },
): Promise<Paginated<ContactTimelineEntry>> {
  const page = normalizePage(input);
  const [rows, countRow] = await Promise.all([
    query<TimelineRow>(
      `SELECT t.kind, t.entry_id, t.type, t.title, t.body, t.metadata, t.ref_id, t.created_at, u.name AS author_name
       FROM (${TIMELINE_SOURCE}) t
       LEFT JOIN users u ON u.id = t.author_id
       ORDER BY t.created_at DESC, t.entry_id DESC
       LIMIT $3 OFFSET $4`,
      [workspaceId, contactId, page.pageSize, page.offset],
    ),
    queryOne<{ count: string }>(`SELECT count(*) AS count FROM (${TIMELINE_SOURCE}) t`, [workspaceId, contactId]),
  ]);

  const items = rows.map<ContactTimelineEntry>((row) => {
    const metadata = row.metadata ?? {};
    const actorFromMetadata = typeof metadata.actorName === "string" ? metadata.actorName : null;
    return {
      id: `${row.kind}:${row.entry_id}`,
      kind: row.kind,
      type: row.type,
      title: row.title,
      body: row.body,
      actorName: row.kind === "note" ? row.author_name : actorFromMetadata,
      refId: row.ref_id,
      metadata,
      createdAt: toIsoRequired(row.created_at),
    };
  });

  return toPaginated(items, Number(countRow?.count ?? 0), page);
}

/* -------------------------------------------------------------------------- */
/* Notes                                                                       */
/* -------------------------------------------------------------------------- */

interface NoteRow {
  id: string;
  contactId: string;
  body: string;
  createdAt: Date;
  authorId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
}

function mapNote(row: NoteRow): ContactNote {
  return {
    id: row.id,
    contactId: row.contactId,
    body: row.body,
    author: row.authorId && row.authorName ? { id: row.authorId, name: row.authorName, avatarUrl: row.authorAvatarUrl } : null,
    createdAt: toIsoRequired(row.createdAt),
  };
}

const noteColumns = {
  id: contactNotes.id,
  contactId: contactNotes.contactId,
  body: contactNotes.body,
  createdAt: contactNotes.createdAt,
  authorId: contactNotes.authorId,
  authorName: users.name,
  authorAvatarUrl: users.avatarUrl,
};

export async function listContactNotes(
  workspaceId: string,
  contactId: string,
  input: { page?: number; pageSize?: number },
): Promise<Paginated<ContactNote>> {
  const page = normalizePage(input);
  const where = and(eq(contactNotes.workspaceId, workspaceId), eq(contactNotes.contactId, contactId));

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db
        .select(noteColumns)
        .from(contactNotes)
        .leftJoin(users, eq(users.id, contactNotes.authorId))
        .where(where)
        .orderBy(desc(contactNotes.createdAt), desc(contactNotes.id))
        .limit(page.pageSize)
        .offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(contactNotes).where(where)),
  ]);
  return toPaginated(rows.map(mapNote), totals[0]?.total ?? 0, page);
}

export async function insertContactNote(
  input: { workspaceId: string; contactId: string; authorId: string; body: string },
  client?: DatabaseClient,
): Promise<ContactNote> {
  const inserted = await withDb(
    (db) =>
      db
        .insert(contactNotes)
        .values({
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          authorId: input.authorId,
          body: input.body,
        })
        .returning({ id: contactNotes.id }),
    client,
  );
  const id = inserted[0]?.id;
  if (!id) throw new Error("Failed to insert contact note");

  const created = await withDb(
    (db) =>
      db
        .select(noteColumns)
        .from(contactNotes)
        .leftJoin(users, eq(users.id, contactNotes.authorId))
        .where(and(eq(contactNotes.workspaceId, input.workspaceId), eq(contactNotes.id, id)))
        .limit(1),
    client,
  );
  if (!created[0]) throw new Error("Contact note vanished after insert");
  return mapNote(created[0]);
}

export async function findContactNoteOwner(
  workspaceId: string,
  contactId: string,
  noteId: string,
  client?: DatabaseClient,
): Promise<{ id: string; authorId: string | null } | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({ id: contactNotes.id, authorId: contactNotes.authorId })
        .from(contactNotes)
        .where(
          and(
            eq(contactNotes.workspaceId, workspaceId),
            eq(contactNotes.contactId, contactId),
            eq(contactNotes.id, noteId),
          ),
        )
        .limit(1),
    client,
  );
  return rows[0] ?? null;
}

export async function deleteContactNoteRow(
  workspaceId: string,
  contactId: string,
  noteId: string,
  client?: DatabaseClient,
): Promise<boolean> {
  const rows = await withDb(
    (db) =>
      db
        .delete(contactNotes)
        .where(
          and(
            eq(contactNotes.workspaceId, workspaceId),
            eq(contactNotes.contactId, contactId),
            eq(contactNotes.id, noteId),
          ),
        )
        .returning({ id: contactNotes.id }),
    client,
  );
  return rows.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Conversations                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Conversations are read with this feature's own query rather than through the
 * inbox feature, so the two domains stay independently deployable; the only
 * coupling is the `conversations.contact_id` column itself.
 */
export async function listContactConversations(
  workspaceId: string,
  contactId: string,
  input: { page?: number; pageSize?: number },
): Promise<Paginated<ContactConversation>> {
  const page = normalizePage(input);
  const where = and(eq(conversations.workspaceId, workspaceId), eq(conversations.contactId, contactId));

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db
        .select({
          id: conversations.id,
          title: conversations.title,
          status: conversations.status,
          channel: conversations.channel,
          messageCount: conversations.messageCount,
          lastMessageAt: conversations.lastMessageAt,
          createdAt: conversations.createdAt,
          chatbotName: chatbots.name,
          agentName: agents.name,
        })
        .from(conversations)
        .leftJoin(chatbots, eq(chatbots.id, conversations.chatbotId))
        .leftJoin(agents, eq(agents.id, conversations.agentId))
        .where(where)
        // A thread with no messages yet sorts by when it was created, so the
        // list has no undated rows at one end.
        .orderBy(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt}) DESC`, desc(conversations.id))
        .limit(page.pageSize)
        .offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(conversations).where(where)),
  ]);

  const items = rows.map<ContactConversation>((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    channel: row.channel,
    messageCount: Number(row.messageCount ?? 0),
    lastMessageAt: toIso(row.lastMessageAt),
    createdAt: toIsoRequired(row.createdAt),
    sourceName: row.chatbotName ?? row.agentName ?? null,
  }));

  return toPaginated(items, totals[0]?.total ?? 0, page);
}

/* -------------------------------------------------------------------------- */
/* AI summary input                                                            */
/* -------------------------------------------------------------------------- */

export async function loadSummaryMaterial(
  workspaceId: string,
  contactId: string,
  limits: { notes: number; messages: number },
): Promise<SummaryMaterial> {
  const [notes, conversationMessages] = await Promise.all([
    withDb((db) =>
      db
        .select({ body: contactNotes.body, authorName: users.name })
        .from(contactNotes)
        .leftJoin(users, eq(users.id, contactNotes.authorId))
        .where(and(eq(contactNotes.workspaceId, workspaceId), eq(contactNotes.contactId, contactId)))
        .orderBy(desc(contactNotes.createdAt))
        .limit(limits.notes),
    ),
    // Scoped through the CONVERSATION's workspace, which is the row that
    // carries the contact link.
    withDb((db) =>
      db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            eq(conversations.workspaceId, workspaceId),
            eq(conversations.contactId, contactId),
            inArray(messages.role, ["user", "assistant"]),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(limits.messages),
    ),
  ]);

  return {
    notes: notes.map((row) => ({ body: row.body, authorName: row.authorName })),
    messages: conversationMessages.map((row) => ({ role: row.role, content: row.content })),
  };
}
