import "server-only";

import { DEFAULT_MEMORY_CONFIG, DEFAULT_MODEL_CONFIG } from "@/features/agents/constants";
import type { CreateAgentInput, updateAgentSchema } from "@/features/agents/schemas";
import {
  countGrantableAgents,
  countWorkspaceKnowledgeBases,
  deleteAgentRow,
  findAgentById,
  getAgentOverview,
  insertAgent,
  listAgents,
  listDelegationCandidates,
  listKnowledgeOptions,
  setAgentDelegations,
  replaceAgentKnowledgeBases,
  updateAgentRow,
  type AgentPatch,
} from "@/features/agents/server/agent-repository";
import type {
  Agent,
  AgentKnowledgeOption,
  AgentListFilters,
  AgentOverview,
  AgentSummary,
  DelegationCandidate,
} from "@/features/agents/types";
import { findChatbotsDeployingAgent } from "@/features/chatbots/server/chatbot-repository";
import { composeToolsColumn } from "@/features/agents/tools/tools-column";
import { assertAttachableServers } from "@/features/mcp/server/agent-mcp";
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

/**
 * Refuses to retire an agent that a chatbot is still deploying.
 *
 * `chatbots.agent_id` is ON DELETE RESTRICT, so the database would refuse the
 * delete anyway - as a foreign-key violation, which tells the operator nothing
 * about which deployment is in the way. Archiving has no such backstop at all:
 * without this check an archived agent would keep serving a live public widget
 * until `resolveChatbotRuntime` failed closed on it. Both paths therefore ask
 * first, and answer with the names.
 */
async function assertNotDeployed(workspaceId: string, agentId: string, verb: string): Promise<void> {
  const deployments = await findChatbotsDeployingAgent(workspaceId, agentId);
  if (deployments.length === 0) return;
  const names = deployments.map((chatbot) => `“${chatbot.name}”`).join(", ");
  throw ApiError.conflict(
    `This agent is deployed by ${deployments.length === 1 ? "chatbot" : "chatbots"} ${names}. Point ${deployments.length === 1 ? "it" : "them"} at another agent, or switch ${deployments.length === 1 ? "it" : "them"} to their own configuration, before you ${verb} it.`,
  );
}

export function getAgents(workspaceId: string, filters: AgentListFilters): Promise<Paginated<AgentSummary>> {
  return listAgents(workspaceId, filters);
}

export async function getAgent(workspaceId: string, agentId: string): Promise<Agent> {
  const agent = await findAgentById(workspaceId, agentId);
  if (!agent) throw ApiError.notFound("Agent not found");
  return agent;
}

export function getAgentDelegationCandidates(workspaceId: string, agentId: string): Promise<DelegationCandidate[]> {
  return listDelegationCandidates(workspaceId, agentId);
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
        canDelegate: input.canDelegate ?? false,
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
        summary: `Created agent “${agent.name}”${agent.canDelegate ? " with delegation enabled" : ""}`,
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

    if (input.status === "archived" && existing.status !== "archived") {
      await assertNotDeployed(ctx.workspaceId, agentId, "archive");
    }

    // A supervisor delegates, and delegation executes other agents. Chatbot
    // channels are deliberately tool-free and reachable by anonymous visitors,
    // so an agent cannot become a supervisor while a chatbot deploys it. The
    // chatbot service refuses the mirror image of this.
    if (input.canDelegate === true && !existing.canDelegate) {
      const deployments = await findChatbotsDeployingAgent(ctx.workspaceId, agentId);
      if (deployments.length > 0) {
        const names = deployments.map((chatbot) => `“${chatbot.name}”`).join(", ");
        throw ApiError.conflict(
          `${names} ${deployments.length === 1 ? "deploys" : "deploy"} this agent. An agent that delegates cannot run in a chatbot channel, so unlink it first.`,
        );
      }
    }

    if (input.delegateIds) {
      const unique = [...new Set(input.delegateIds)];
      // Ownership, archived status and self-delegation in one count. The
      // database refuses all three as well; this is what turns the refusal into
      // a message rather than a constraint violation.
      const grantable = await countGrantableAgents(ctx.workspaceId, agentId, unique, client);
      if (grantable !== unique.length) {
        throw ApiError.validation({
          delegateIds: ["One or more agents are not available to delegate to in this workspace"],
        });
      }
      await setAgentDelegations(ctx.workspaceId, agentId, unique, client);
    }

    if (input.collectionIds) {
      const unique = [...new Set(input.collectionIds)];
      const owned = await countWorkspaceKnowledgeBases(ctx.workspaceId, unique, client);
      if (owned !== unique.length) {
        throw ApiError.validation({ collectionIds: ["One or more collections do not belong to this workspace"] });
      }
      await replaceAgentKnowledgeBases(ctx.workspaceId, agentId, unique, client);
    }

    // The `tools` column holds two halves: built-in settings and MCP
    // attachments. It is replaced outright, so writing one half alone would
    // erase the other. Compose both, from the patch where given and from the
    // stored agent otherwise, and only when at least one half is changing.
    let toolsPatch: AgentPatch["tools"];
    if (input.tools !== undefined || input.mcpTools !== undefined) {
      if (input.mcpTools !== undefined) {
        await assertAttachableServers(ctx.workspaceId, input.mcpTools);
      }
      toolsPatch = composeToolsColumn(input.tools ?? existing.tools, input.mcpTools ?? existing.mcpTools);
    }

    const patch: AgentPatch = {
      name: input.name,
      description: input.description === undefined ? undefined : input.description?.trim() ? input.description.trim() : null,
      instructions: input.instructions,
      status: input.status,
      modelConfig: input.modelConfig ? { ...DEFAULT_MODEL_CONFIG, ...input.modelConfig } : undefined,
      tools: toolsPatch,
      memoryConfig: input.memoryConfig ? { ...DEFAULT_MEMORY_CONFIG, ...input.memoryConfig } : undefined,
      outputSchema: input.outputSchema,
      requiresApproval: input.requiresApproval,
      canDelegate: input.canDelegate,
      delegationConfig: input.delegationConfig,
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
  await assertNotDeployed(ctx.workspaceId, agentId, "delete");
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
