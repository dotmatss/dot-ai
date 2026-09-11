import "server-only";

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
import { query, queryOne, type Queryable } from "@/server/db/client";
import { likePattern, normalizePage, ParamBuilder, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

/**
 * All CRM SQL. Every statement filters on `workspace_id` with a positional
 * parameter; RLS is the second line of defence, not the first.
 */

interface ContactRow {
  id: string;
  workspace_id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  company: string | null;
  stage: ContactStage;
  source: string | null;
  tags: string[] | null;
  properties: Record<string, unknown> | null;
  ai_summary: string | null;
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ContactDetailRow extends ContactRow {
  note_count: string | number;
  conversation_count: string | number;
  activity_count: string | number;
}

// `email` is citext; casting to text keeps the driver's value a plain string.
const CONTACT_COLUMNS = `
  c.id, c.workspace_id, c.email::text AS email, c.name, c.phone, c.company, c.stage, c.source,
  c.tags, c.properties, c.ai_summary, c.last_seen_at, c.created_at, c.updated_at
`;

const CONTACT_DETAIL_COLUMNS = `
  ${CONTACT_COLUMNS},
  (SELECT count(*) FROM contact_notes n WHERE n.workspace_id = c.workspace_id AND n.contact_id = c.id) AS note_count,
  (SELECT count(*) FROM conversations cv WHERE cv.workspace_id = c.workspace_id AND cv.contact_id = c.id) AS conversation_count,
  (SELECT count(*) FROM contact_activities a WHERE a.workspace_id = c.workspace_id AND a.contact_id = c.id) AS activity_count
`;

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
    lastSeenAt: toIso(row.last_seen_at),
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
  };
}

function mapContact(row: ContactDetailRow): Contact {
  return {
    ...mapSummary(row),
    workspaceId: row.workspace_id,
    properties: normalizeProperties(row.properties),
    aiSummary: row.ai_summary,
    noteCount: Number(row.note_count ?? 0),
    conversationCount: Number(row.conversation_count ?? 0),
    activityCount: Number(row.activity_count ?? 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Contacts                                                                    */
/* -------------------------------------------------------------------------- */

export async function listContacts(workspaceId: string, filters: ContactListFilters): Promise<Paginated<ContactSummary>> {
  const page = normalizePage(filters);
  const params = new ParamBuilder();
  const where: string[] = [`c.workspace_id = ${params.add(workspaceId)}`];

  if (filters.q) {
    const pattern = params.add(likePattern(filters.q));
    where.push(`(c.name ILIKE ${pattern} OR c.email::text ILIKE ${pattern} OR c.company ILIKE ${pattern})`);
  }
  if (filters.stage) {
    where.push(`c.stage = ${params.add(filters.stage)}`);
  }
  if (filters.tag) {
    // Containment (rather than = ANY) is what the GIN index on tags serves.
    where.push(`c.tags @> ARRAY[${params.add(filters.tag)}]::text[]`);
  }

  const whereSql = where.join(" AND ");
  const whereValues = [...params.values];

  const [rows, countRow] = await Promise.all([
    query<ContactRow>(
      `SELECT ${CONTACT_COLUMNS} FROM contacts c WHERE ${whereSql}
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ${params.add(page.pageSize)} OFFSET ${params.add(page.offset)}`,
      params.values,
    ),
    queryOne<{ count: string }>(`SELECT count(*) AS count FROM contacts c WHERE ${whereSql}`, whereValues),
  ]);

  return toPaginated(rows.map(mapSummary), Number(countRow?.count ?? 0), page);
}

export async function findContactById(workspaceId: string, contactId: string, client?: Queryable): Promise<Contact | null> {
  const row = await queryOne<ContactDetailRow>(
    `SELECT ${CONTACT_DETAIL_COLUMNS} FROM contacts c WHERE c.workspace_id = $1 AND c.id = $2`,
    [workspaceId, contactId],
    client,
  );
  return row ? mapContact(row) : null;
}

/** Identity lookup for the per-workspace email uniqueness rule and for upserts. */
export async function findContactIdByEmail(workspaceId: string, email: string, client?: Queryable): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    "SELECT id FROM contacts WHERE workspace_id = $1 AND email = $2",
    [workspaceId, email],
    client,
  );
  return row?.id ?? null;
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

export async function insertContact(input: InsertContactInput, client?: Queryable): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO contacts (workspace_id, name, email, phone, company, source, stage, tags, properties, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      input.workspaceId,
      input.name,
      input.email,
      input.phone,
      input.company,
      input.source,
      input.stage,
      input.tags,
      JSON.stringify(input.properties),
      input.lastSeenAt ?? null,
    ],
    client,
  );
  if (!row) throw new Error("Failed to insert contact");
  return row.id;
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

const COLUMN_BY_FIELD: Record<keyof ContactPatch, string> = {
  name: "name",
  email: "email",
  phone: "phone",
  company: "company",
  source: "source",
  stage: "stage",
  tags: "tags",
  properties: "properties",
  aiSummary: "ai_summary",
  lastSeenAt: "last_seen_at",
};

export async function updateContactRow(
  workspaceId: string,
  contactId: string,
  patch: ContactPatch,
  client?: Queryable,
): Promise<void> {
  const params = new ParamBuilder();
  const sets: string[] = [];
  for (const [field, value] of Object.entries(patch) as Array<[keyof ContactPatch, unknown]>) {
    if (value === undefined) continue;
    const placeholder = params.add(field === "properties" ? JSON.stringify(value) : value);
    sets.push(`${COLUMN_BY_FIELD[field]} = ${placeholder}`);
  }
  if (sets.length === 0) return;
  await query(
    `UPDATE contacts SET ${sets.join(", ")} WHERE workspace_id = ${params.add(workspaceId)} AND id = ${params.add(contactId)}`,
    params.values,
    client,
  );
}

export async function deleteContactRow(workspaceId: string, contactId: string): Promise<boolean> {
  const rows = await query<{ id: string }>("DELETE FROM contacts WHERE workspace_id = $1 AND id = $2 RETURNING id", [
    workspaceId,
    contactId,
  ]);
  return rows.length > 0;
}

/** Distinct tags with usage counts, powering the tag filter facet. */
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

export async function insertContactActivity(input: InsertContactActivityInput, client?: Queryable): Promise<void> {
  await query(
    `INSERT INTO contact_activities (workspace_id, contact_id, type, description, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.workspaceId, input.contactId, input.type, input.description, JSON.stringify(input.metadata ?? {})],
    client,
  );
}

/**
 * The merged history. Notes and conversations are events in their own right,
 * so they are unioned with the recorded activities rather than fetched
 * separately and stitched together in JavaScript, which would make pagination
 * across the three sources incorrect.
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
  contact_id: string;
  body: string;
  created_at: Date;
  author_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
}

function mapNote(row: NoteRow): ContactNote {
  return {
    id: row.id,
    contactId: row.contact_id,
    body: row.body,
    author: row.author_id && row.author_name ? { id: row.author_id, name: row.author_name, avatarUrl: row.author_avatar_url } : null,
    createdAt: toIsoRequired(row.created_at),
  };
}

const NOTE_COLUMNS = `
  n.id, n.contact_id, n.body, n.created_at, n.author_id,
  u.name AS author_name, u.avatar_url AS author_avatar_url
`;

export async function listContactNotes(
  workspaceId: string,
  contactId: string,
  input: { page?: number; pageSize?: number },
): Promise<Paginated<ContactNote>> {
  const page = normalizePage(input);
  const [rows, countRow] = await Promise.all([
    query<NoteRow>(
      `SELECT ${NOTE_COLUMNS}
       FROM contact_notes n
       LEFT JOIN users u ON u.id = n.author_id
       WHERE n.workspace_id = $1 AND n.contact_id = $2
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT $3 OFFSET $4`,
      [workspaceId, contactId, page.pageSize, page.offset],
    ),
    queryOne<{ count: string }>("SELECT count(*) AS count FROM contact_notes WHERE workspace_id = $1 AND contact_id = $2", [
      workspaceId,
      contactId,
    ]),
  ]);
  return toPaginated(rows.map(mapNote), Number(countRow?.count ?? 0), page);
}

export async function insertContactNote(
  input: { workspaceId: string; contactId: string; authorId: string; body: string },
  client?: Queryable,
): Promise<ContactNote> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO contact_notes (workspace_id, contact_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.workspaceId, input.contactId, input.authorId, input.body],
    client,
  );
  if (!row) throw new Error("Failed to insert contact note");
  const created = await queryOne<NoteRow>(
    `SELECT ${NOTE_COLUMNS} FROM contact_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.workspace_id = $1 AND n.id = $2`,
    [input.workspaceId, row.id],
    client,
  );
  if (!created) throw new Error("Contact note vanished after insert");
  return mapNote(created);
}

export async function findContactNoteOwner(
  workspaceId: string,
  contactId: string,
  noteId: string,
  client?: Queryable,
): Promise<{ id: string; authorId: string | null } | null> {
  const row = await queryOne<{ id: string; author_id: string | null }>(
    "SELECT id, author_id FROM contact_notes WHERE workspace_id = $1 AND contact_id = $2 AND id = $3",
    [workspaceId, contactId, noteId],
    client,
  );
  return row ? { id: row.id, authorId: row.author_id } : null;
}

export async function deleteContactNoteRow(
  workspaceId: string,
  contactId: string,
  noteId: string,
  client?: Queryable,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    "DELETE FROM contact_notes WHERE workspace_id = $1 AND contact_id = $2 AND id = $3 RETURNING id",
    [workspaceId, contactId, noteId],
    client,
  );
  return rows.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Conversations                                                               */
/* -------------------------------------------------------------------------- */

interface ConversationRow {
  id: string;
  title: string | null;
  status: string;
  channel: string;
  message_count: number;
  last_message_at: Date | null;
  created_at: Date;
  chatbot_name: string | null;
  agent_name: string | null;
}

/**
 * Conversations are read with this feature's own SQL rather than through the
 * inbox feature, so the two domains stay independently deployable; the only
 * coupling is the `conversations.contact_id` column itself.
 */
export async function listContactConversations(
  workspaceId: string,
  contactId: string,
  input: { page?: number; pageSize?: number },
): Promise<Paginated<ContactConversation>> {
  const page = normalizePage(input);
  const [rows, countRow] = await Promise.all([
    query<ConversationRow>(
      `SELECT cv.id, cv.title, cv.status::text AS status, cv.channel::text AS channel, cv.message_count,
              cv.last_message_at, cv.created_at, cb.name AS chatbot_name, ag.name AS agent_name
       FROM conversations cv
       LEFT JOIN chatbots cb ON cb.id = cv.chatbot_id
       LEFT JOIN agents ag ON ag.id = cv.agent_id
       WHERE cv.workspace_id = $1 AND cv.contact_id = $2
       ORDER BY coalesce(cv.last_message_at, cv.created_at) DESC, cv.id DESC
       LIMIT $3 OFFSET $4`,
      [workspaceId, contactId, page.pageSize, page.offset],
    ),
    queryOne<{ count: string }>("SELECT count(*) AS count FROM conversations WHERE workspace_id = $1 AND contact_id = $2", [
      workspaceId,
      contactId,
    ]),
  ]);

  const items = rows.map<ContactConversation>((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    channel: row.channel,
    messageCount: Number(row.message_count ?? 0),
    lastMessageAt: toIso(row.last_message_at),
    createdAt: toIsoRequired(row.created_at),
    sourceName: row.chatbot_name ?? row.agent_name ?? null,
  }));

  return toPaginated(items, Number(countRow?.count ?? 0), page);
}

/* -------------------------------------------------------------------------- */
/* AI summary input                                                            */
/* -------------------------------------------------------------------------- */

export async function loadSummaryMaterial(
  workspaceId: string,
  contactId: string,
  limits: { notes: number; messages: number },
): Promise<SummaryMaterial> {
  const [notes, messages] = await Promise.all([
    query<{ body: string; author_name: string | null }>(
      `SELECT n.body, u.name AS author_name
       FROM contact_notes n
       LEFT JOIN users u ON u.id = n.author_id
       WHERE n.workspace_id = $1 AND n.contact_id = $2
       ORDER BY n.created_at DESC
       LIMIT $3`,
      [workspaceId, contactId, limits.notes],
    ),
    query<{ role: string; content: string }>(
      `SELECT m.role::text AS role, m.content
       FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       WHERE cv.workspace_id = $1 AND cv.contact_id = $2 AND m.role IN ('user', 'assistant')
       ORDER BY m.created_at DESC
       LIMIT $3`,
      [workspaceId, contactId, limits.messages],
    ),
  ]);

  return {
    notes: notes.map((row) => ({ body: row.body, authorName: row.author_name })),
    messages: messages.map((row) => ({ role: row.role, content: row.content })),
  };
}
