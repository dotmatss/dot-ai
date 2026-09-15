// @vitest-environment node
/**
 * A workflow running an agent, end to end against real PostgreSQL:
 *
 *   Workflow → agent.run → agent engine → AgentExecutionResult → {{vars.x}} → Respond
 *
 * `workflows-agent-run.test.ts` proves the engine contract with a stub runner;
 * this proves the REAL runner the server binds in `executor.ts`:
 *
 *   1. The run succeeds and the agent's answer reaches the run output.
 *   2. The agent's turn is recorded in `agent_executions`, linked to the run
 *      (`workflow_run_id`), as a root at depth 0 - and creates NO conversation.
 *   3. An agent from another workspace is "not available": the run fails and
 *      no execution row is ever opened for it.
 *   4. An archived agent is refused the same way.
 *   5. An agent that can itself delegate still runs as a workflow step.
 *
 * REQUIRES MIGRATION 0022. Skipped automatically without DATABASE_URL:
 *   DATABASE_URL="postgresql://…" node scripts/verify.mjs --tests workflow-agent-run-persistence
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgent, updateAgent, type ActorContext } from "@/features/agents/server/agent-service";
import type { WorkflowDefinition } from "@/features/workflows/domain/definition";
import { startWorkflowRun } from "@/features/workflows/server/executor";
import { createWorkflow, updateWorkflow } from "@/features/workflows/server/workflow-service";
import { query, queryOne } from "@/server/db/client";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suffix = Math.random().toString(36).slice(2, 10);

let actor: ActorContext;
let otherActor: ActorContext;
const organizationIds: string[] = [];

async function insertUser(email: string): Promise<string> {
  const row = await queryOne<{ id: string }>("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id", [email, "Workflow Agent Tester"]);
  if (!row) throw new Error("failed to insert user");
  return row.id;
}

async function insertTenant(label: string, ownerId: string): Promise<string> {
  const organization = await queryOne<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [
    `WfAgent ${label} ${suffix}`,
    `wfagent-${label}-${suffix}`,
  ]);
  if (!organization) throw new Error("failed to insert organization");
  organizationIds.push(organization.id);
  await query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [organization.id, ownerId]);
  const workspace = await queryOne<{ id: string }>("INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id", [
    organization.id,
    `WfAgent WS ${label} ${suffix}`,
    `wfagent-ws-${label}-${suffix}`,
  ]);
  if (!workspace) throw new Error("failed to insert workspace");
  return workspace.id;
}

async function activeAgent(ctx: ActorContext, name: string, overrides: { canDelegate?: boolean } = {}) {
  const agent = await createAgent(ctx, { name, canDelegate: overrides.canDelegate });
  return updateAgent(ctx, agent.id, { instructions: `You are ${name}. Answer in one sentence.`, status: "active" });
}

/** Start → the agent → Respond with its answer. */
function definitionFor(agentId: string): WorkflowDefinition {
  return {
    nodes: [
      { id: "start", type: "trigger.manual", label: "Start", config: { note: "" } },
      { id: "agent", type: "agent.run", label: "Ask the agent", config: { agentId, task: "Answer this: {{trigger.message}}", outputKey: "agentAnswer" } },
      { id: "respond", type: "output.respond", label: "Respond", config: { message: "{{vars.agentAnswer}}", outputKey: "message" } },
    ],
    edges: [
      { id: "e1", from: "start", to: "agent" },
      { id: "e2", from: "agent", to: "respond" },
    ],
  };
}

async function workflowRunning(ctx: ActorContext, agentId: string, name: string) {
  const workflow = await createWorkflow(ctx, { name });
  await updateWorkflow(ctx, workflow.id, { definition: definitionFor(agentId) });
  return startWorkflowRun({
    ctx,
    workflowId: workflow.id,
    input: {},
    trigger: { kind: "manual", label: "test", payload: { message: "Do you offer refunds?" } },
  });
}

describe.skipIf(!hasDatabase)("Workflow → agent.run (PostgreSQL)", () => {
  beforeAll(async () => {
    const ownerId = await insertUser(`wfagent-${suffix}@example.test`);
    actor = { workspaceId: await insertTenant("a", ownerId), userId: ownerId };
    otherActor = { workspaceId: await insertTenant("b", ownerId), userId: ownerId };
  }, 30_000);

  afterAll(async () => {
    for (const organizationId of organizationIds) {
      await query("DELETE FROM organizations WHERE id = $1", [organizationId]);
    }
  });

  it("runs the agent and carries its answer into the run output", async () => {
    const agent = await activeAgent(actor, `Answerer ${suffix}`);
    const run = await workflowRunning(actor, agent.id, `Ask ${suffix}`);

    expect(run.status).toBe("succeeded");
    expect(run.steps.map((step) => step.nodeId)).toEqual(["start", "agent", "respond"]);
    expect(run.steps.every((step) => step.status === "succeeded")).toBe(true);

    const answer = (run.output as { message?: string } | null)?.message ?? "";
    expect(answer.trim().length).toBeGreaterThan(0);
    // The respond step rendered {{vars.agentAnswer}}, so the same text is in the step.
    expect(run.steps[1]?.output).toMatchObject({ status: "succeeded", answer });
  }, 60_000);

  it("records the turn as a root execution linked to the run, and opens no conversation", async () => {
    const agent = await activeAgent(actor, `Recorded ${suffix}`);
    const run = await workflowRunning(actor, agent.id, `Recorded ${suffix}`);
    const executionId = (run.steps[1]?.output as { executionId?: string } | null)?.executionId;
    expect(executionId).toBeTruthy();

    const row = await queryOne<{
      agent_id: string;
      workflow_run_id: string | null;
      depth: number;
      status: string;
      parent_execution_id: string | null;
      root_execution_id: string;
      input_task: string | null;
      input_tokens: number;
    }>(
      "SELECT agent_id, workflow_run_id, depth, status, parent_execution_id, root_execution_id, input_task, input_tokens FROM agent_executions WHERE workspace_id = $1 AND id = $2",
      [actor.workspaceId, executionId],
    );
    expect(row).not.toBeNull();
    expect(row?.agent_id).toBe(agent.id);
    // Linked to the run: the whole agent tree of a run is one indexed lookup.
    expect(row?.workflow_run_id).toBe(run.id);
    expect(row?.depth).toBe(0);
    expect(row?.parent_execution_id).toBeNull();
    expect(row?.root_execution_id).toBe(executionId);
    expect(row?.status).toBe("succeeded");
    expect(row?.input_task).toContain("Do you offer refunds?");
    // Metered by the agent engine, against the agent that spent it.
    expect(row?.input_tokens).toBeGreaterThan(0);

    // A workflow step is not a thread the user opened.
    const conversations = await query<{ id: string }>("SELECT id FROM conversations WHERE workspace_id = $1 AND agent_id = $2", [
      actor.workspaceId,
      agent.id,
    ]);
    expect(conversations).toEqual([]);
  }, 60_000);

  it("refuses an agent from another workspace without opening an execution for it", async () => {
    const theirs = await activeAgent(otherActor, `Theirs ${suffix}`);
    const run = await workflowRunning(actor, theirs.id, `Crossing ${suffix}`);

    expect(run.status).toBe("failed");
    expect(run.error).toBe("That agent is not available in this workspace.");
    expect(run.steps.map((step) => [step.nodeId, step.status])).toEqual([["start", "succeeded"], ["agent", "failed"]]);

    // Refused before any row was opened - in EITHER workspace.
    const rows = await query<{ id: string }>("SELECT id FROM agent_executions WHERE agent_id = $1", [theirs.id]);
    expect(rows).toEqual([]);
  }, 60_000);

  it("refuses an archived agent", async () => {
    const agent = await activeAgent(actor, `Retired ${suffix}`);
    await updateAgent(actor, agent.id, { status: "archived" });
    const run = await workflowRunning(actor, agent.id, `Retired wf ${suffix}`);

    expect(run.status).toBe("failed");
    expect(run.error).toContain("archived");
  }, 60_000);

  it("runs an agent that can itself delegate, still as a root linked to the run", async () => {
    const child = await activeAgent(actor, `Specialist ${suffix}`);
    const lead = await activeAgent(actor, `Lead ${suffix}`, { canDelegate: true });
    await updateAgent(actor, lead.id, { delegateIds: [child.id] });

    const run = await workflowRunning(actor, lead.id, `Delegating wf ${suffix}`);
    expect(run.status).toBe("succeeded");

    const rows = await query<{ agent_id: string; depth: number; workflow_run_id: string | null }>(
      "SELECT agent_id, depth, workflow_run_id FROM agent_executions WHERE workspace_id = $1 AND workflow_run_id = $2 ORDER BY depth",
      [actor.workspaceId, run.id],
    );
    // The lead ran as the root. Whether it delegated is the model's call; if it
    // did, every child row carries the same run id.
    expect(rows[0]).toMatchObject({ agent_id: lead.id, depth: 0, workflow_run_id: run.id });
    expect(rows.every((row) => row.workflow_run_id === run.id)).toBe(true);
  }, 60_000);
});
