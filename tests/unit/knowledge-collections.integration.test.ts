// @vitest-environment node
/**
 * Integration test for Collections against real PostgreSQL.
 *
 * These are the four claims migration 0016 and the Collections model make, and
 * every one of them is a claim about the database rather than about the UI:
 *
 *   1. An unorganized document is indexed but outside every retrieval scope.
 *   2. Filing it makes it retrievable, without re-indexing anything.
 *   3. Moving a document keeps its chunks' denormalized collection_id in step.
 *   4. Deleting a collection un-files its documents instead of destroying them.
 *
 * (1) is the security property the whole model exists for, so it is asserted
 * against the real retrieval query rather than a stub.
 *
 * Skipped automatically when DATABASE_URL is not configured:
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/dot_dev" node scripts/verify.mjs --tests knowledge-collections
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createCollection,
  createKnowledgeSource,
  deleteCollection,
  getCollection,
  getKnowledgeSources,
  moveKnowledgeSource,
  type ActorContext,
} from "@/features/knowledge/server/knowledge-service";
import { retrieveKnowledge } from "@/features/knowledge/server/retrieval";
import { KNOWLEDGE_SCOPE_ALL, KNOWLEDGE_SCOPE_UNORGANIZED, collectionScope } from "@/features/knowledge/types";
import { isApiError } from "@/lib/api/api-error";
import { query, queryOne } from "@/server/db/client";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suffix = Math.random().toString(36).slice(2, 10);

/** Distinctive enough that a stray match would be a real bug, not a stop word. */
const MARKER = "zarquon";
const CONTENT = `The ${MARKER} allowance is reimbursed within thirty days of the claim being filed.`;

let actor: ActorContext;
let otherWorkspaceId: string;

async function insertUser(email: string): Promise<string> {
  const row = await queryOne<{ id: string }>("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id", [
    email,
    "Collections Tester",
  ]);
  if (!row) throw new Error("failed to insert user");
  return row.id;
}

async function insertTenant(label: string, ownerId: string): Promise<string> {
  const organization = await queryOne<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
    [`Collections ${label} ${suffix}`, `collections-${label}-${suffix}`],
  );
  if (!organization) throw new Error("failed to insert organization");
  await query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [
    organization.id,
    ownerId,
  ]);
  const workspace = await queryOne<{ id: string }>(
    "INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
    [organization.id, `Collections WS ${label} ${suffix}`, `collections-ws-${label}-${suffix}`],
  );
  if (!workspace) throw new Error("failed to insert workspace");
  return workspace.id;
}

/** A text source, fully processed by the inline pipeline. */
function addSource(collectionId: string | null, name: string) {
  return createKnowledgeSource(actor, collectionId, { type: "text", name, content: CONTENT });
}

async function chunkCollectionIds(sourceId: string): Promise<Array<string | null>> {
  const rows = await query<{ collection_id: string | null }>(
    "SELECT collection_id FROM knowledge_chunks WHERE workspace_id = $1 AND source_id = $2 ORDER BY position",
    [actor.workspaceId, sourceId],
  );
  return rows.map((row) => row.collection_id);
}

describe.skipIf(!hasDatabase)("Collections persistence (PostgreSQL)", () => {
  beforeAll(async () => {
    const ownerId = await insertUser(`collections-${suffix}@example.test`);
    actor = { workspaceId: await insertTenant("a", ownerId), userId: ownerId };
    otherWorkspaceId = await insertTenant("b", ownerId);
  }, 30_000);

  afterAll(async () => {
    for (const workspaceId of [actor?.workspaceId, otherWorkspaceId]) {
      if (workspaceId) await query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    }
  });

  it("indexes an unorganized document but keeps it out of every retrieval scope", async () => {
    const collection = await createCollection(actor, { name: `Policies ${suffix}` });
    const unfiled = await addSource(null, `unfiled-${suffix}.txt`);

    // It really is indexed: this is a staging area, not a holding pen.
    expect(unfiled.status).toBe("ready");
    expect(unfiled.chunkCount).toBeGreaterThan(0);
    expect(unfiled.collectionId).toBeNull();
    expect(unfiled.collectionName).toBeNull();

    // ...and it is listed in the UI, under both scopes that should show it.
    // The list filter matches names and URIs, not content: full-text search over
    // passages is retrieval's job, and retrieval is exactly what is scoped away.
    const all = await getKnowledgeSources(actor.workspaceId, KNOWLEDGE_SCOPE_ALL, { q: "unfiled-" });
    const unorganized = await getKnowledgeSources(actor.workspaceId, KNOWLEDGE_SCOPE_UNORGANIZED, {});
    expect(all.items.map((s) => s.id)).toContain(unfiled.id);
    expect(unorganized.items.map((s) => s.id)).toContain(unfiled.id);

    // The marker appears only in the content, so it must not match the list.
    const byContent = await getKnowledgeSources(actor.workspaceId, KNOWLEDGE_SCOPE_ALL, { q: MARKER });
    expect(byContent.items).toEqual([]);

    // But no agent can reach it. This is the claim that matters.
    const hits = await retrieveKnowledge(actor.workspaceId, [collection.id], MARKER);
    expect(hits).toEqual([]);
  }, 30_000);

  it("makes a document retrievable when it is filed, and unreachable again when unfiled", async () => {
    const collection = await createCollection(actor, { name: `HR ${suffix}` });
    const source = await addSource(null, `handbook-${suffix}.txt`);

    expect(await retrieveKnowledge(actor.workspaceId, [collection.id], MARKER)).toEqual([]);

    const filed = await moveKnowledgeSource(actor, source.id, { collectionId: collection.id });
    expect(filed.collectionId).toBe(collection.id);
    expect(filed.collectionName).toBe(collection.name);
    // Filing is a metadata move: the passages indexed at upload are reused.
    expect(filed.chunkCount).toBe(source.chunkCount);

    const hits = await retrieveKnowledge(actor.workspaceId, [collection.id], MARKER);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.title).toBe(filed.name);

    const unfiled = await moveKnowledgeSource(actor, source.id, { collectionId: null });
    expect(unfiled.collectionId).toBeNull();
    expect(await retrieveKnowledge(actor.workspaceId, [collection.id], MARKER)).toEqual([]);
  }, 30_000);

  it("keeps chunk collection ids in step with the document when it moves", async () => {
    const from = await createCollection(actor, { name: `From ${suffix}` });
    const to = await createCollection(actor, { name: `To ${suffix}` });
    const source = await addSource(from.id, `moving-${suffix}.txt`);

    expect(new Set(await chunkCollectionIds(source.id))).toEqual(new Set([from.id]));

    await moveKnowledgeSource(actor, source.id, { collectionId: to.id });

    // A chunk left behind would be content retrievable from a collection the
    // document is no longer in.
    expect(new Set(await chunkCollectionIds(source.id))).toEqual(new Set([to.id]));
    expect(await retrieveKnowledge(actor.workspaceId, [from.id], MARKER)).toEqual([]);
    expect((await retrieveKnowledge(actor.workspaceId, [to.id], MARKER)).length).toBeGreaterThan(0);
  }, 30_000);

  it("un-files documents when a collection is deleted, rather than destroying them", async () => {
    const collection = await createCollection(actor, { name: `Doomed ${suffix}` });
    const source = await addSource(collection.id, `survivor-${suffix}.txt`);

    await deleteCollection(actor, collection.id);

    await expect(getCollection(actor.workspaceId, collection.id)).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 404,
    );

    // The document and its passages are intact, and now unorganized.
    const unorganized = await getKnowledgeSources(actor.workspaceId, KNOWLEDGE_SCOPE_UNORGANIZED, {});
    const survivor = unorganized.items.find((item) => item.id === source.id);
    expect(survivor).toBeDefined();
    expect(survivor?.collectionId).toBeNull();
    expect(survivor?.chunkCount).toBe(source.chunkCount);
    expect(await chunkCollectionIds(source.id)).toEqual(Array(source.chunkCount).fill(null));
  }, 30_000);

  it("refuses to file a document into another workspace's collection", async () => {
    const mine = await addSource(null, `mine-${suffix}.txt`);
    const theirs = await queryOne<{ id: string }>(
      "INSERT INTO knowledge_collections (workspace_id, name) VALUES ($1, $2) RETURNING id",
      [otherWorkspaceId, `Theirs ${suffix}`],
    );
    if (!theirs) throw new Error("failed to insert foreign collection");

    await expect(moveKnowledgeSource(actor, mine.id, { collectionId: theirs.id })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 404,
    );

    const after = await getKnowledgeSources(actor.workspaceId, collectionScope(theirs.id), {}).catch(() => null);
    expect(after).toBeNull();
  }, 30_000);
});
