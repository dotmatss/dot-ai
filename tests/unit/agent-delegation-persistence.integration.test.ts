// @vitest-environment node
/**
 * Supervisor delegation against real PostgreSQL.
 *
 * `agent-delegation.test.ts` covers the decision; this covers the guarantees
 * only the database can make, and the boundary only a real child run can prove:
 *
 *   1. A cross-workspace grant is refused by the DATABASE, not just the service.
 *      Both foreign keys are composite and share one `workspace_id`, so the row
 *      shape does not exist.
 *   2. Self-delegation is refused by a CHECK.
 *   3. Removing a grant disables it rather than deleting it.
 *   4. A delegated child really runs, on its OWN configuration, and is recorded
 *      as an execution under its parent - without creating a conversation.
 *   5. A supervisor cannot be deployed to a public chatbot, in either direction.
 *
 * REQUIRES MIGRATION 0021. Skipped automatically without DATABASE_URL:
 *   DATABASE_URL="postgresql://…" node scripts/verify.mjs --tests agent-delegation-persistence
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgent, getAgent, updateAgent, type ActorContext } from "@/features/agents/server/agent-service";
import { createBudget, executeAgentTask, openRootExecution } from "@/features/agents/server/agent-execution";
import { FULL_TOOL_POLICY } from "@/features/agents/server/agent-engine";
import { listExecutionTree } from "@/features/agents/server/agent-execution-repository";
import { createChatbot, updateChatbot } from "@/features/chatbots/server/chatbot-service";
import { isApiError } from "@/lib/api/api-error";
import { query, queryOne } from "@/server/db/client";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suffix = Math.random().toString(36).slice(2, 10);

let actor: ActorContext;
let otherActor: ActorContext;
const organizationIds: string[] = [];

async function insertUser(email: string): Promise<string> {
  const row = await queryOne<{ id: string }>("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id", [email, "Delegation Tester"]);
  if (!row) throw new Error("failed to insert user");
  return row.id;
}

async function insertTenant(label: string, ownerId: string): Promise<string> {
  const organization = await queryOne<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [
    `Deleg ${label} ${suffix}`,
    `deleg-${label}-${suffix}`,
  ]);
  if (!organization) throw new Error("failed to insert organization");
  organizationIds.push(organization.id);
  await query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [organization.id, ownerId]);
  const workspace = await queryOne<{ id: string }>("INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id", [
    organization.id,
    `Deleg WS ${label} ${suffix}`,
    `deleg-ws-${label}-${suffix}`,
  ]);
  if (!workspace) throw new Error("failed to insert workspace");
  return workspace.id;
}

/** An active agent with instructions, ready to be delegated to. */
async function activeAgent(ctx: ActorContext, name: string, overrides: { canDelegate?: boolean } = {}) {
  const agent = await createAgent(ctx, { name, canDelegate: overrides.canDelegate });
  return updateAgent(ctx, agent.id, { instructions: `You are ${name}. Answer briefly.`, status: "active" });
}

describe.skipIf(!hasDatabase)("Supervisor delegation (PostgreSQL)", () => {
  beforeAll(async () => {
    const ownerId = await insertUser(`deleg-${suffix}@example.test`);
    actor = { workspaceId: await insertTenant("a", ownerId), userId: ownerId };
    otherActor = { workspaceId: await insertTenant("b", ownerId), userId: ownerId };
  }, 30_000);

  afterAll(async () => {
    for (const organizationId of organizationIds) {
      await query("DELETE FROM organizations WHERE id = $1", [organizationId]);
    }
  });

  it("grants a supervisor exactly the agents that were ticked", async () => {
    const supervisor = await activeAgent(actor, `Supervisor ${suffix}`, { canDelegate: true });
    const research = await activeAgent(actor, `Research ${suffix}`);
    const finance = await activeAgent(actor, `Finance ${suffix}`);

    const updated = await updateAgent(actor, supervisor.id, { delegateIds: [research.id] });

    expect(updated.canDelegate).toBe(true);
    expect(updated.delegateIds).toEqual([research.id]);
    // Being in the same workspace grants nothing on its own.
    expect(updated.delegateIds).not.toContain(finance.id);
  }, 30_000);

  it("refuses a cross-workspace grant in the service and in the database", async () => {
    const supervisor = await activeAgent(actor, `Boundary sup ${suffix}`, { canDelegate: true });
    const theirs = await activeAgent(otherActor, `Theirs ${suffix}`);

    await expect(updateAgent(actor, supervisor.id, { delegateIds: [theirs.id] })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 422,
    );

    // The composite foreign keys share one workspace_id column, so even a
    // direct write cannot produce a grant that spans two workspaces.
    await expect(
      query("INSERT INTO agent_delegations (supervisor_agent_id, child_agent_id, workspace_id) VALUES ($1, $2, $3)", [
        supervisor.id,
        theirs.id,
        actor.workspaceId,
      ]),
    ).rejects.toThrow();

    expect((await getAgent(actor.workspaceId, supervisor.id)).delegateIds).toEqual([]);
  }, 30_000);

  it("refuses self-delegation at the database level", async () => {
    const supervisor = await activeAgent(actor, `Selfish ${suffix}`, { canDelegate: true });

    await expect(updateAgent(actor, supervisor.id, { delegateIds: [supervisor.id] })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 422,
    );
    await expect(
      query("INSERT INTO agent_delegations (supervisor_agent_id, child_agent_id, workspace_id) VALUES ($1, $1, $2)", [
        supervisor.id,
        actor.workspaceId,
      ]),
    ).rejects.toThrow();
  }, 30_000);

  it("disables a removed grant instead of forgetting it", async () => {
    const supervisor = await activeAgent(actor, `Keeper ${suffix}`, { canDelegate: true });
    const child = await activeAgent(actor, `Kept ${suffix}`);

    await updateAgent(actor, supervisor.id, { delegateIds: [child.id] });
    await updateAgent(actor, supervisor.id, { delegateIds: [] });

    expect((await getAgent(actor.workspaceId, supervisor.id)).delegateIds).toEqual([]);
    // The row survives, switched off - and a disabled grant is refused exactly
    // like a missing one.
    const rows = await query<{ enabled: boolean }>(
      "SELECT enabled FROM agent_delegations WHERE workspace_id = $1 AND supervisor_agent_id = $2 AND child_agent_id = $3",
      [actor.workspaceId, supervisor.id, child.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(false);
  }, 30_000);

  it("runs a child on its own configuration and records it under its parent", async () => {
    const supervisor = await activeAgent(actor, `Runner sup ${suffix}`, { canDelegate: true });
    const child = await activeAgent(actor, `Runner child ${suffix}`);
    await updateAgent(actor, supervisor.id, { delegateIds: [child.id] });

    const reloaded = await getAgent(actor.workspaceId, supervisor.id);
    const root = await openRootExecution({
      workspaceId: actor.workspaceId,
      agentId: supervisor.id,
      conversationId: null,
      budget: createBudget(reloaded.delegationConfig),
      toolPolicy: FULL_TOOL_POLICY,
      userId: actor.userId,
    });

    const result = await executeAgentTask({
      workspaceId: actor.workspaceId,
      childAgentId: child.id,
      task: "Summarise the situation.",
      context: null,
      parent: root,
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("succeeded");
    expect(result.output).toBeTruthy();

    // Recorded as a child of the root, at depth 1, with the path that cycle
    // detection reads.
    const tree = await listExecutionTree(actor.workspaceId, root.rootExecutionId);
    expect(tree).toHaveLength(2);
    const childNode = tree.find((node) => node.id === result.executionId);
    expect(childNode?.parentExecutionId).toBe(root.executionId);
    expect(childNode?.depth).toBe(1);
    expect(childNode?.agentId).toBe(child.id);
    expect(childNode?.inputTask).toBe("Summarise the situation.");

    const path = await queryOne<{ agent_path: string[] }>("SELECT agent_path FROM agent_executions WHERE id = $1", [result.executionId]);
    expect(path?.agent_path).toEqual([supervisor.id, child.id]);

    // A delegated task is not a thread: no conversation was created for it.
    const conversations = await query<{ id: string }>("SELECT id FROM conversations WHERE workspace_id = $1 AND agent_id = $2", [
      actor.workspaceId,
      child.id,
    ]);
    expect(conversations).toEqual([]);
  }, 60_000);

  it("refuses to run a child from another workspace even when asked directly", async () => {
    const supervisor = await activeAgent(actor, `Crosser ${suffix}`, { canDelegate: true });
    const theirs = await activeAgent(otherActor, `Their child ${suffix}`);

    const reloaded = await getAgent(actor.workspaceId, supervisor.id);
    const root = await openRootExecution({
      workspaceId: actor.workspaceId,
      agentId: supervisor.id,
      conversationId: null,
      budget: createBudget(reloaded.delegationConfig),
      toolPolicy: FULL_TOOL_POLICY,
      userId: actor.userId,
    });

    // The child is reloaded by (workspaceId, childAgentId), so an id from
    // another tenant resolves to nothing rather than to that tenant's agent.
    const result = await executeAgentTask({
      workspaceId: actor.workspaceId,
      childAgentId: theirs.id,
      task: "Do their work",
      context: null,
      parent: root,
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("refused");
    expect(result.output).toBeNull();
  }, 30_000);

  it("keeps supervisors out of public chatbot channels, in both directions", async () => {
    const supervisor = await activeAgent(actor, `Public sup ${suffix}`, { canDelegate: true });
    const standard = await activeAgent(actor, `Public standard ${suffix}`);
    const bot = await createChatbot(actor, { name: `Public bot ${suffix}` });

    // Deploying a supervisor is refused outright rather than silently running
    // it with its delegation switched off.
    await expect(updateChatbot(actor, bot.id, { agentId: supervisor.id })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 422,
    );

    // And the mirror image: an agent already deployed cannot become one.
    await updateChatbot(actor, bot.id, { agentId: standard.id });
    await expect(updateAgent(actor, standard.id, { canDelegate: true })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 409,
    );
  }, 30_000);
});
