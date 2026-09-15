import "server-only";

import { randomBytes } from "node:crypto";

import { findAgentById } from "@/features/agents/server/agent-repository";
import { DEFAULT_APPEARANCE, DEFAULT_MODEL_CONFIG } from "@/features/chatbots/constants";
import type { CreateChatbotInput, updateChatbotSchema } from "@/features/chatbots/schemas";
import {
  countWorkspaceKnowledgeBases,
  deleteChatbotRow,
  findChatbotById,
  getChatbotOverview,
  insertChatbot,
  listChatbots,
  listKnowledgeOptions,
  replaceChatbotKnowledgeBases,
  slugExists,
  updateChatbotRow,
  type ChatbotPatch,
} from "@/features/chatbots/server/chatbot-repository";
import type { Chatbot, ChatbotKnowledgeOption, ChatbotListFilters, ChatbotOverview, ChatbotSummary } from "@/features/chatbots/types";
import { ApiError } from "@/lib/api/api-error";
import { slugify, withSuffix } from "@/lib/slug";
import { recordActivity } from "@/server/activity/activity-log";
import { withWorkspace } from "@/server/db/client";
import type { Paginated } from "@/types/pagination";
import type { z } from "zod";

export interface ActorContext {
  workspaceId: string;
  userId: string;
}

type UpdateInput = z.output<typeof updateChatbotSchema>;

export function getChatbots(workspaceId: string, filters: ChatbotListFilters): Promise<Paginated<ChatbotSummary>> {
  return listChatbots(workspaceId, filters);
}

export async function getChatbot(workspaceId: string, chatbotId: string): Promise<Chatbot> {
  const chatbot = await findChatbotById(workspaceId, chatbotId);
  if (!chatbot) throw ApiError.notFound("Chatbot not found");
  return chatbot;
}

export function getChatbotKnowledgeOptions(workspaceId: string, chatbotId: string): Promise<ChatbotKnowledgeOption[]> {
  return listKnowledgeOptions(workspaceId, chatbotId);
}

export async function getChatbotOverviewStats(workspaceId: string, chatbotId: string): Promise<ChatbotOverview> {
  await getChatbot(workspaceId, chatbotId);
  return getChatbotOverview(workspaceId, chatbotId);
}

function generateEmbedKey(): string {
  return `cb_${randomBytes(12).toString("base64url")}`;
}

export async function createChatbot(ctx: ActorContext, input: CreateChatbotInput): Promise<Chatbot> {
  return withWorkspace(ctx.workspaceId, async (client) => {
    const root = slugify(input.name);
    let slug = root;
    for (let attempt = 0; await slugExists(ctx.workspaceId, slug, client); attempt++) {
      if (attempt > 50) throw ApiError.conflict("Could not allocate a unique slug");
      slug = withSuffix(root, attempt + 1);
    }
    const chatbot = await insertChatbot(
      {
        workspaceId: ctx.workspaceId,
        createdBy: ctx.userId,
        name: input.name,
        slug,
        description: input.description?.trim() ? input.description.trim() : null,
        embedKey: generateEmbedKey(),
        modelConfig: DEFAULT_MODEL_CONFIG,
        appearance: DEFAULT_APPEARANCE,
      },
      client,
    );
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "chatbot",
        entityId: chatbot.id,
        action: "created",
        summary: `Created chatbot “${chatbot.name}”`,
      },
      client,
    );
    return chatbot;
  });
}

export async function updateChatbot(ctx: ActorContext, chatbotId: string, input: UpdateInput): Promise<Chatbot> {
  return withWorkspace(ctx.workspaceId, async (client) => {
    const existing = await findChatbotById(ctx.workspaceId, chatbotId, client);
    if (!existing) throw ApiError.notFound("Chatbot not found");

    if (input.collectionIds) {
      const unique = [...new Set(input.collectionIds)];
      const owned = await countWorkspaceKnowledgeBases(ctx.workspaceId, unique, client);
      if (owned !== unique.length) {
        throw ApiError.validation({ collectionIds: ["One or more collections do not belong to this workspace"] });
      }
      await replaceChatbotKnowledgeBases(ctx.workspaceId, chatbotId, unique, client);
    }

    // Linking an agent. Resolved through THIS workspace, so an id belonging to
    // another tenant is indistinguishable from one that does not exist - and
    // the composite foreign key would refuse the write regardless. Unlinking
    // (null) needs no check: it only ever returns the chatbot to its own
    // configuration, which it still has.
    if (input.agentId) {
      const agent = await findAgentById(ctx.workspaceId, input.agentId, client);
      if (!agent) {
        throw ApiError.validation({ agentId: ["That agent does not belong to this workspace"] });
      }
      // An archived agent is retired. Deploying one would put configuration
      // somebody deliberately took out of service in front of the public.
      if (agent.status === "archived") {
        throw ApiError.validation({ agentId: ["That agent is archived. Restore it before deploying it."] });
      }
      // A supervisor delegates, and delegation executes other agents. A chatbot
      // channel is anonymous and deliberately tool-free, so a supervisor is
      // refused outright rather than quietly deployed with its delegation
      // switched off - which would be a different agent than the one chosen.
      if (agent.canDelegate) {
        throw ApiError.validation({
          agentId: ["Agents with delegation enabled cannot be deployed to a chatbot yet. Choose an agent that does not delegate, or switch delegation off."],
        });
      }
    }

    const patch: ChatbotPatch = {
      name: input.name,
      description: input.description === undefined ? undefined : input.description?.trim() ? input.description.trim() : null,
      instructions: input.instructions,
      welcomeMessage: input.welcomeMessage,
      status: input.status,
      modelConfig: input.modelConfig ? { ...DEFAULT_MODEL_CONFIG, ...input.modelConfig } : undefined,
      agentId: input.agentId,
      appearance: input.appearance ? { ...DEFAULT_APPEARANCE, ...input.appearance } : undefined,
      allowedDomains: input.allowedDomains ? [...new Set(input.allowedDomains)] : undefined,
    };
    await updateChatbotRow(ctx.workspaceId, chatbotId, patch, client);

    const updated = await findChatbotById(ctx.workspaceId, chatbotId, client);
    if (!updated) throw ApiError.notFound("Chatbot not found");

    if (input.status && input.status !== existing.status) {
      await recordActivity(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.userId,
          entityType: "chatbot",
          entityId: chatbotId,
          action: `status:${input.status}`,
          summary: `Set chatbot “${updated.name}” to ${input.status}`,
        },
        client,
      );
    } else {
      await recordActivity(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.userId,
          entityType: "chatbot",
          entityId: chatbotId,
          action: "updated",
          summary: `Updated chatbot “${updated.name}”`,
          metadata: { fields: Object.keys(input) },
        },
        client,
      );
    }
    return updated;
  });
}

export async function deleteChatbot(ctx: ActorContext, chatbotId: string): Promise<void> {
  const existing = await findChatbotById(ctx.workspaceId, chatbotId);
  if (!existing) throw ApiError.notFound("Chatbot not found");
  await deleteChatbotRow(ctx.workspaceId, chatbotId);
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "chatbot",
    entityId: chatbotId,
    action: "deleted",
    summary: `Deleted chatbot “${existing.name}”`,
  });
}
