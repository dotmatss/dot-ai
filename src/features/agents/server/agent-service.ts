import "server-only";

import { DEFAULT_MEMORY_CONFIG, DEFAULT_MODEL_CONFIG } from "@/features/agents/constants";
import type { CreateAgentInput, updateAgentSchema } from "@/features/agents/schemas";
import {
  countWorkspaceKnowledgeBases,
  deleteAgentRow,
  findAgentById,
  getAgentOverview,
  insertAgent,
  listAgents,
  listKnowledgeOptions,
  replaceAgentKnowledgeBases,
  updateAgentRow,
  type AgentPatch,
} from "@/features/agents/server/agent-repository";
import type { Agent, AgentKnowledgeOption, AgentListFilters, AgentOverview, AgentSummary } from "@/features/agents/types";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import { withWorkspace } from "@/server/db/client";
import type { Paginated } from "@/types/pagination";
import type { z } from "zod";

export interface ActorContext {
  workspaceId: string;
  userId: string;
}

type UpdateInput = z.output<typeof updateAgentSchema>;

export function getAgents(workspaceId: string, filters: AgentListFilters): Promise<Paginated<AgentSummary>> {
  return listAgents(workspaceId, filters);
}

export async function getAgent(workspaceId: string, agentId: string): Promise<Agent> {
  const agent = await findAgentById(workspaceId, agentId);
  if (!agent) throw ApiError.notFound("Agent not found");
  return agent;
}

export function getAgentKnowledgeOptions(workspaceId: string, agentId: string): Promise<AgentKnowledgeOption[]> {
  return listKnowledgeOptions(workspaceId, agentId);
}

export async function getAgentOverviewStats(workspaceId: string, agentId: string): Promise<AgentOverview> {
  await getAgent(workspaceId, agentId);
  return getAgentOverview(workspaceId, agentId);
}

export async function createAgent(ctx: ActorContext, input: CreateAgentInput): Promise<Agent> {
  return withWorkspace(ctx.workspaceId, async (client) => {
    const agent = await insertAgent(
      {
        workspaceId: ctx.workspaceId,
        createdBy: ctx.userId,
        name: input.name,
        description: input.description?.trim() ? input.description.trim() : null,
        modelConfig: DEFAULT_MODEL_CONFIG,
        memoryConfig: DEFAULT_MEMORY_CONFIG,
      },
      client,
    );
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "agent",
        entityId: agent.id,
        action: "created",
        summary: `Created agent “${agent.name}”`,
      },
      client,
    );
    return agent;
  });
}

export async function updateAgent(ctx: ActorContext, agentId: string, input: UpdateInput): Promise<Agent> {
  return withWorkspace(ctx.workspaceId, async (client) => {
    const existing = await findAgentById(ctx.workspaceId, agentId, client);
    if (!existing) throw ApiError.notFound("Agent not found");

    // An agent with no instructions has nothing to act on, so activation is blocked
    // until they exist (either already saved or arriving in the same patch).
    if (input.status === "active") {
      const instructions = input.instructions ?? existing.instructions;
      if (!instructions.trim()) {
        throw ApiError.validation({ status: ["Write instructions before activating this agent"] }, "Instructions are required to activate");
      }
    }

    if (input.knowledgeBaseIds) {
      const unique = [...new Set(input.knowledgeBaseIds)];
      const owned = await countWorkspaceKnowledgeBases(ctx.workspaceId, unique, client);
      if (owned !== unique.length) {
        throw ApiError.validation({ knowledgeBaseIds: ["One or more knowledge bases do not belong to this workspace"] });
      }
      await replaceAgentKnowledgeBases(ctx.workspaceId, agentId, unique, client);
    }

    const patch: AgentPatch = {
      name: input.name,
      description: input.description === undefined ? undefined : input.description?.trim() ? input.description.trim() : null,
      instructions: input.instructions,
      status: input.status,
      modelConfig: input.modelConfig ? { ...DEFAULT_MODEL_CONFIG, ...input.modelConfig } : undefined,
      tools: input.tools,
      memoryConfig: input.memoryConfig ? { ...DEFAULT_MEMORY_CONFIG, ...input.memoryConfig } : undefined,
      outputSchema: input.outputSchema,
      requiresApproval: input.requiresApproval,
    };
    await updateAgentRow(ctx.workspaceId, agentId, patch, client);

    const updated = await findAgentById(ctx.workspaceId, agentId, client);
    if (!updated) throw ApiError.notFound("Agent not found");

    if (input.status && input.status !== existing.status) {
      await recordActivity(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.userId,
          entityType: "agent",
          entityId: agentId,
          action: `status:${input.status}`,
          summary: `Set agent “${updated.name}” to ${input.status}`,
        },
        client,
      );
    } else {
      await recordActivity(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.userId,
          entityType: "agent",
          entityId: agentId,
          action: "updated",
          summary: `Updated agent “${updated.name}”`,
          metadata: {
            fields: Object.keys(input),
            ...(input.tools ? { enabledTools: updated.tools.filter((tool) => tool.enabled).map((tool) => tool.toolId) } : {}),
          },
        },
        client,
      );
    }
    return updated;
  });
}

export async function deleteAgent(ctx: ActorContext, agentId: string): Promise<void> {
  const existing = await findAgentById(ctx.workspaceId, agentId);
  if (!existing) throw ApiError.notFound("Agent not found");
  await deleteAgentRow(ctx.workspaceId, agentId);
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "agent",
    entityId: agentId,
    action: "deleted",
    summary: `Deleted agent “${existing.name}”`,
  });
}
