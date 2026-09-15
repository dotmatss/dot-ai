// @vitest-environment node
/**
 * Integration test for MULTIPLE agents per workspace, against real PostgreSQL.
 *
 * The schema has always allowed more than one agent per workspace (`agents` is
 * keyed on a uuid and carries no unique constraint on `name`). What was never
 * asserted is that the behaviour around that actually holds, so these are the
 * claims the multiple-agent model rests on:
 *
 *   1. A workspace owns several agents at once, each independently configured.
 *   2. An agent's identity is its id, not its name. Renaming changes nothing
 *      that points at it.
 *   3. Knowledge is REFERENCED, not copied: two agents can read one collection,
 *      and detaching one leaves the other untouched.
 *   4. An agent cannot be read, written, deleted or pointed at another
 *      workspace's resources - collections or MCP servers - across the tenant
 *      boundary.
 *   5. The lifecycle states behave: archiving hides an agent from the default
 *      list without destroying it, and activation requires instructions.
 *   6. Deleting an agent keeps its conversations, which is what the UI promises
 *      the moment before it calls DELETE.
 *
 * (4) is the security property; it is asserted through the service, which is
 * the only door the route handlers use.
 *
 * Skipped automatically when DATABASE_URL is not configured:
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/dot_dev" node scripts/verify.mjs --tests agents-persistence
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAgent,
  deleteAgent,
  getAgent,
  getAgentKnowledgeOptions,
  getAgents,
  updateAgent,
  type ActorContext,
} from "@/features/agents/server/agent-service";
import { createConversation, findConversation } from "@/features/conversations/server/conversation-repository";
import { isApiError } from "@/lib/api/api-error";
import { query, queryOne } from "@/server/db/client";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suffix = Math.random().toString(36).slice(2, 10);

let actor: ActorContext;
let otherActor: ActorContext;

async function insertUser(email: string): Promise<string> {
  const row = await queryOne<{ id: string }>("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id", [
    email,
    "Agents Tester",
  ]);
  if (!row) throw new Error("failed to insert user");
  return row.id;
}

async function insertTenant(label: string, ownerId: string): Promise<string> {
  const organization = await queryOne<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
    [`Agents ${label} ${suffix}`, `agents-${label}-${suffix}`],
  );
  if (!organization) throw new Error("failed to insert organization");
  await query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [
    organization.id,
    ownerId,
  ]);
  const workspace = await queryOne<{ id: string }>(
    "INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
    [organization.id, `Agents WS ${label} ${suffix}`, `agents-ws-${label}-${suffix}`],
  );
  if (!workspace) throw new Error("failed to insert workspace");
  return workspace.id;
}

async function insertCollection(workspaceId: string, name: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    "INSERT INTO knowledge_collections (workspace_id, name) VALUES ($1, $2) RETURNING id",
    [workspaceId, name],
  );
  if (!row) throw new Error("failed to insert collection");
  return row.id;
}

async function insertMcpServer(workspaceId: string, slug: string): Promise<void> {
  await query(
    `INSERT INTO mcp_servers (workspace_id, name, slug, endpoint_url, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [workspaceId, `Server ${slug}`, slug, "https://mcp.example.test/v1"],
  );
}

/** Collection ids actually stored in the join table, bypassing the read model. */
async function storedCollectionIds(workspaceId: string, agentId: string): Promise<string[]> {
  const rows = await query<{ collection_id: string }>(
    "SELECT collection_id FROM agent_collections WHERE workspace_id = $1 AND agent_id = $2 ORDER BY collection_id",
    [workspaceId, agentId],
  );
  return rows.map((row) => row.collection_id);
}

describe.skipIf(!hasDatabase)("Multiple agents per workspace (PostgreSQL)", () => {
  beforeAll(async () => {
    const ownerId = await insertUser(`agents-${suffix}@example.test`);
    actor = { workspaceId: await insertTenant("a", ownerId), userId: ownerId };
    otherActor = { workspaceId: await insertTenant("b", ownerId), userId: ownerId };
  }, 30_000);

  afterAll(async () => {
    for (const workspaceId of [actor?.workspaceId, otherActor?.workspaceId]) {
      if (workspaceId) await query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    }
  });

  it("holds several independently configured agents in one workspace", async () => {
    const support = await createAgent(actor, { name: `Support ${suffix}`, description: "Answers customer questions" });
    const sales = await createAgent(actor, { name: `Sales ${suffix}`, description: "Qualifies leads" });
    const research = await createAgent(actor, { name: `Research ${suffix}` });

    // Three rows, three distinct identifiers. Nothing about creation collapses
    // them onto a single per-workspace agent.
    expect(new Set([support.id, sales.id, research.id]).size).toBe(3);
    expect(support.workspaceId).toBe(actor.workspaceId);

    // Configuring one leaves the others exactly as they were.
    await updateAgent(actor, support.id, {
      instructions: "Answer from the handbook and escalate billing questions.",
      modelConfig: { model: "quality", temperature: 0.1, maxTokens: 4096 },
      requiresApproval: true,
    });

    const [reloadedSupport, reloadedSales] = await Promise.all([
      getAgent(actor.workspaceId, support.id),
      getAgent(actor.workspaceId, sales.id),
    ]);
    expect(reloadedSupport.instructions).toContain("handbook");
    expect(reloadedSupport.modelConfig.maxTokens).toBe(4096);
    expect(reloadedSupport.requiresApproval).toBe(true);
    expect(reloadedSales.instructions).toBe("");
    expect(reloadedSales.requiresApproval).toBe(false);
    expect(reloadedSales.modelConfig.maxTokens).not.toBe(4096);

    const listed = await getAgents(actor.workspaceId, { q: suffix });
    expect(listed.items.map((item) => item.id).sort()).toEqual([support.id, sales.id, research.id].sort());
  }, 30_000);

  it("keeps an agent's identity when its name changes", async () => {
    const agent = await createAgent(actor, { name: `Customer Support Agent ${suffix}` });
    const conversation = await createConversation({
      workspaceId: actor.workspaceId,
      agentId: agent.id,
      channel: "agent",
      title: "Before the rename",
    });

    const renamed = await updateAgent(actor, agent.id, { name: `Support Assistant ${suffix}` });

    // The id is the identity: it survives, and so does everything keyed to it.
    expect(renamed.id).toBe(agent.id);
    expect(renamed.createdAt).toBe(agent.createdAt);
    expect(renamed.name).toBe(`Support Assistant ${suffix}`);

    const stillLinked = await findConversation(actor.workspaceId, conversation.id);
    expect(stillLinked?.agentId).toBe(agent.id);
  }, 30_000);

  it("lets two agents share one collection without copying it", async () => {
    const collectionId = await insertCollection(actor.workspaceId, `Shared handbook ${suffix}`);
    const first = await createAgent(actor, { name: `Sharer one ${suffix}` });
    const second = await createAgent(actor, { name: `Sharer two ${suffix}` });

    await updateAgent(actor, first.id, { collectionIds: [collectionId] });
    await updateAgent(actor, second.id, { collectionIds: [collectionId] });

    // One collection row, referenced twice - not duplicated per agent.
    expect(await storedCollectionIds(actor.workspaceId, first.id)).toEqual([collectionId]);
    expect(await storedCollectionIds(actor.workspaceId, second.id)).toEqual([collectionId]);
    const collectionRows = await query<{ id: string }>(
      "SELECT id FROM knowledge_collections WHERE workspace_id = $1 AND id = $2",
      [actor.workspaceId, collectionId],
    );
    expect(collectionRows).toHaveLength(1);

    // Detaching one agent must not reach the other's access.
    await updateAgent(actor, first.id, { collectionIds: [] });
    expect(await storedCollectionIds(actor.workspaceId, first.id)).toEqual([]);
    expect(await storedCollectionIds(actor.workspaceId, second.id)).toEqual([collectionId]);
    expect((await getAgent(actor.workspaceId, second.id)).collectionIds).toEqual([collectionId]);
  }, 30_000);

  it("hides another workspace's agent behind a 404 rather than a 403", async () => {
    const theirs = await createAgent(otherActor, { name: `Theirs ${suffix}` });

    // Reading it, writing it and deleting it are all "not found" from here:
    // confirming existence to a non-member is itself a disclosure.
    await expect(getAgent(actor.workspaceId, theirs.id)).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 404,
    );
    await expect(updateAgent(actor, theirs.id, { name: `Stolen ${suffix}` })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 404,
    );
    await expect(deleteAgent(actor, theirs.id)).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 404,
    );

    // And it is genuinely untouched, not merely reported as missing.
    const survivor = await getAgent(otherActor.workspaceId, theirs.id);
    expect(survivor.name).toBe(`Theirs ${suffix}`);

    // It is absent from this workspace's list, however the list is filtered.
    const listed = await getAgents(actor.workspaceId, { q: `Theirs ${suffix}` });
    expect(listed.items).toEqual([]);
  }, 30_000);

  it("refuses to attach another workspace's collection or MCP server", async () => {
    const agent = await createAgent(actor, { name: `Boundary ${suffix}` });
    const foreignCollectionId = await insertCollection(otherActor.workspaceId, `Theirs ${suffix}`);
    const foreignSlug = `their-server-${suffix}`;
    await insertMcpServer(otherActor.workspaceId, foreignSlug);

    await expect(updateAgent(actor, agent.id, { collectionIds: [foreignCollectionId] })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 422,
    );

    // Attachments are addressed by slug, so a guessed slug is the attack; the
    // slug exists, just not in this workspace.
    await expect(
      updateAgent(actor, agent.id, {
        mcpTools: [{ source: "mcp", serverSlug: foreignSlug, toolName: "search", enabled: true, requiresApproval: true }],
      }),
    ).rejects.toSatisfy((error: unknown) => isApiError(error) && error.status === 422);

    // Nothing was half-written by either rejected patch.
    expect(await storedCollectionIds(actor.workspaceId, agent.id)).toEqual([]);
    expect((await getAgent(actor.workspaceId, agent.id)).mcpTools).toEqual([]);

    // The knowledge picker offers only this workspace's collections.
    const options = await getAgentKnowledgeOptions(actor.workspaceId, agent.id);
    expect(options.map((option) => option.id)).not.toContain(foreignCollectionId);
  }, 30_000);

  it("archives an agent out of the default list without destroying it", async () => {
    const agent = await createAgent(actor, { name: `Retiring ${suffix}` });
    await updateAgent(actor, agent.id, { instructions: "Handle overflow." });

    await updateAgent(actor, agent.id, { status: "archived" });

    const defaultList = await getAgents(actor.workspaceId, { q: `Retiring ${suffix}` });
    expect(defaultList.items).toEqual([]);

    // Still addressable by id, and still listed when archived is asked for -
    // which is what keeps historical conversations explainable.
    const archived = await getAgent(actor.workspaceId, agent.id);
    expect(archived.status).toBe("archived");
    expect(archived.instructions).toBe("Handle overflow.");
    const archivedList = await getAgents(actor.workspaceId, { q: `Retiring ${suffix}`, status: "archived" });
    expect(archivedList.items.map((item) => item.id)).toEqual([agent.id]);
  }, 30_000);

  it("will not activate an agent that has no instructions to act on", async () => {
    const agent = await createAgent(actor, { name: `Empty ${suffix}` });

    await expect(updateAgent(actor, agent.id, { status: "active" })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 422,
    );
    expect((await getAgent(actor.workspaceId, agent.id)).status).toBe("draft");

    // Instructions arriving in the same patch satisfy the guard.
    const activated = await updateAgent(actor, agent.id, { status: "active", instructions: "Do the thing." });
    expect(activated.status).toBe("active");
  }, 30_000);

  it("keeps conversations when the agent that handled them is deleted", async () => {
    const agent = await createAgent(actor, { name: `Doomed ${suffix}` });
    const conversation = await createConversation({
      workspaceId: actor.workspaceId,
      agentId: agent.id,
      channel: "agent",
      title: "Handled before deletion",
    });

    await deleteAgent(actor, agent.id);

    await expect(getAgent(actor.workspaceId, agent.id)).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 404,
    );

    // The transcript survives - this is exactly what the delete dialog promises.
    // Its agent link is cleared rather than cascaded, so history is kept but
    // attribution is lost: archiving is the reversible option.
    const kept = await findConversation(actor.workspaceId, conversation.id);
    expect(kept).not.toBeNull();
    expect(kept?.title).toBe("Handled before deletion");
    expect(kept?.agentId).toBeNull();

    // The knowledge links are gone with the agent, not left dangling.
    expect(await storedCollectionIds(actor.workspaceId, agent.id)).toEqual([]);
  }, 30_000);
});
