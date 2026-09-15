// @vitest-environment node
/**
 * The audit read model against a real PostgreSQL.
 *
 * The parser is unit-tested; what needs a database is the SQL it feeds: that
 * the `where` is built once and applied identically to the page and the count,
 * that an inclusive `to` date includes the whole day, that the bigserial id
 * survives JSON, and - the one that matters - that neither the list nor the
 * facets can see another workspace's entries.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/dot_dev" pnpm exec vitest run audit-persistence
 *
 * Skipped when DATABASE_URL is absent, so the default suite stays hermetic.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getAuditFacets, getAuditLog, listRecentActivity } from "@/features/audit/server/audit-service";

const connectionString = process.env.DATABASE_URL;
const suffix = Math.random().toString(36).slice(2, 10);

let admin: pg.Client;
const ids = { userId: "", otherUserId: "", workspaceId: "", otherWorkspaceId: "" };

async function createWorkspace(label: string): Promise<string> {
  const org = await admin.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [
    `${label} ${suffix}`,
    `${label}-${suffix}`,
  ]);
  const workspace = await admin.query<{ id: string }>(
    "INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
    [org.rows[0]!.id, `${label} WS`, `${label}-ws-${suffix}`],
  );
  return workspace.rows[0]!.id;
}

async function log(entry: {
  workspaceId: string;
  actorId: string | null;
  entityType: string;
  action: string;
  summary: string;
  daysAgo?: number;
}): Promise<void> {
  await admin.query(
    `INSERT INTO activity_log (workspace_id, actor_id, entity_type, entity_id, action, summary, created_at)
     VALUES ($1, $2, $3, NULL, $4, $5, now() - ($6::int * interval '1 day'))`,
    [entry.workspaceId, entry.actorId, entry.entityType, entry.action, entry.summary, entry.daysAgo ?? 0],
  );
}

function isoDay(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(!connectionString)("audit log persistence", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString });
    await admin.connect();

    const user = await admin.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, 'Audit Actor', 'x') RETURNING id",
      [`audit-${suffix}@example.com`],
    );
    ids.userId = user.rows[0]!.id;
    const other = await admin.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, 'Second Actor', 'x') RETURNING id",
      [`audit-other-${suffix}@example.com`],
    );
    ids.otherUserId = other.rows[0]!.id;

    ids.workspaceId = await createWorkspace("audit");
    ids.otherWorkspaceId = await createWorkspace("audit-other");

    await log({ workspaceId: ids.workspaceId, actorId: ids.userId, entityType: "chatbot", action: "created", summary: "Created chatbot Alpha", daysAgo: 0 });
    await log({ workspaceId: ids.workspaceId, actorId: ids.userId, entityType: "chatbot", action: "published", summary: "Published chatbot Alpha", daysAgo: 1 });
    await log({ workspaceId: ids.workspaceId, actorId: ids.otherUserId, entityType: "agent", action: "created", summary: "Created agent Beta", daysAgo: 5 });
    await log({ workspaceId: ids.workspaceId, actorId: null, entityType: "workflow", action: "activated", summary: "Activated workflow Gamma", daysAgo: 20 });
    await log({ workspaceId: ids.otherWorkspaceId, actorId: ids.otherUserId, entityType: "contact", action: "created", summary: "Created contact in another tenant", daysAgo: 0 });
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.query("DELETE FROM organizations WHERE slug LIKE $1", [`%${suffix}`]).catch(() => undefined);
    await admin.query("DELETE FROM users WHERE email LIKE $1", [`%${suffix}@example.com`]).catch(() => undefined);
    await admin.end().catch(() => undefined);
  });

  it("returns this workspace's entries, newest first, with a serialisable id", async () => {
    const page = await getAuditLog(ids.workspaceId, { page: 1, pageSize: 25 });

    expect(page.total).toBe(4);
    expect(page.items.map((entry) => entry.summary)).toEqual([
      "Created chatbot Alpha",
      "Published chatbot Alpha",
      "Created agent Beta",
      "Activated workflow Gamma",
    ]);
    // bigserial reaches the driver as a BigInt; unconverted it would throw here.
    expect(() => JSON.stringify(page)).not.toThrow();
    expect(typeof page.items[0]!.id).toBe("string");
  });

  it("never shows another workspace's entries", async () => {
    const page = await getAuditLog(ids.workspaceId, { page: 1, pageSize: 25 });
    expect(page.items.some((entry) => entry.summary.includes("another tenant"))).toBe(false);

    const facets = await getAuditFacets(ids.workspaceId);
    expect(facets.entityTypes).not.toContain("contact");

    // ...and the scoping holds in the other direction: the neighbouring
    // workspace sees only its own row, not ours.
    const neighbour = await getAuditLog(ids.otherWorkspaceId, { page: 1, pageSize: 25 });
    expect(neighbour.total).toBe(1);
    expect(neighbour.items[0]!.summary).toBe("Created contact in another tenant");
  });

  it("filters by entity type, actor and action, counting what it lists", async () => {
    const byType = await getAuditLog(ids.workspaceId, { entityType: "chatbot", page: 1, pageSize: 25 });
    expect(byType.total).toBe(2);
    expect(byType.items).toHaveLength(2);

    const byActor = await getAuditLog(ids.workspaceId, { actorId: ids.otherUserId, page: 1, pageSize: 25 });
    expect(byActor.total).toBe(1);
    expect(byActor.items[0]!.summary).toBe("Created agent Beta");

    const byAction = await getAuditLog(ids.workspaceId, { action: "created", page: 1, pageSize: 25 });
    expect(byAction.total).toBe(2);
  });

  it("searches summaries and actor names", async () => {
    const bySummary = await getAuditLog(ids.workspaceId, { q: "Gamma", page: 1, pageSize: 25 });
    expect(bySummary.total).toBe(1);

    const byActorName = await getAuditLog(ids.workspaceId, { q: "Second Actor", page: 1, pageSize: 25 });
    expect(byActorName.total).toBe(1);
    expect(byActorName.items[0]!.actorName).toBe("Second Actor");

    // A wildcard typed by a person is a literal, not a pattern.
    const literal = await getAuditLog(ids.workspaceId, { q: "%", page: 1, pageSize: 25 });
    expect(literal.total).toBe(0);
  });

  it("treats the date bounds as inclusive days", async () => {
    // `to` is today: an exclusive comparison would drop everything after
    // midnight, which is most of what a person is looking for.
    const today = await getAuditLog(ids.workspaceId, { from: isoDay(0), to: isoDay(0), page: 1, pageSize: 25 });
    expect(today.total).toBe(1);

    const week = await getAuditLog(ids.workspaceId, { from: isoDay(7), to: isoDay(0), page: 1, pageSize: 25 });
    expect(week.total).toBe(3);
  });

  it("pages without losing or repeating a row", async () => {
    const first = await getAuditLog(ids.workspaceId, { page: 1, pageSize: 2 });
    const second = await getAuditLog(ids.workspaceId, { page: 2, pageSize: 2 });

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(first.total).toBe(4);
    expect(second.total).toBe(4);
    const ids_ = [...first.items, ...second.items].map((entry) => entry.id);
    expect(new Set(ids_).size).toBe(4);
  });

  it("offers only facet values that exist in this workspace", async () => {
    const facets = await getAuditFacets(ids.workspaceId);
    expect(facets.entityTypes).toEqual(["agent", "chatbot", "workflow"]);
    expect(facets.actions).toEqual(["activated", "created", "published"]);
    expect(facets.actors.map((actor) => actor.name)).toEqual(["Audit Actor", "Second Actor"]);
  });

  it("keeps an entry whose actor is gone, showing no name", async () => {
    const page = await getAuditLog(ids.workspaceId, { entityType: "workflow", page: 1, pageSize: 25 });
    expect(page.items[0]!.actorId).toBeNull();
    expect(page.items[0]!.actorName).toBeNull();
  });

  it("feeds the dashboard card the same rows, unfiltered", async () => {
    const recent = await listRecentActivity(ids.workspaceId, 2);
    expect(recent.map((entry) => entry.summary)).toEqual(["Created chatbot Alpha", "Published chatbot Alpha"]);
  });
});
