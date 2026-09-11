import "server-only";

import { CONVERSATION_DETAIL_MESSAGE_LIMIT } from "@/features/conversations/constants";
import type { HumanReplyInput, UpdateConversationInput } from "@/features/conversations/schemas";
import { generateConversationSummary } from "@/features/conversations/server/conversation-summary";
import {
  appendMessage,
  contactExists,
  findConversationDetail,
  isWorkspaceMember,
  listConversationMessages,
  listConversations,
  saveConversationSummary,
  searchContacts,
  updateConversationRow,
  type ConversationPatch,
} from "@/features/conversations/server/conversation-repository";
import type {
  ContactSearchResult,
  Conversation,
  ConversationAiSummary,
  ConversationDetail,
  ConversationListFilters,
  ConversationListItem,
  ConversationReplyResult,
} from "@/features/conversations/types";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import { withWorkspace } from "@/server/db/client";
import { toIsoRequired } from "@/server/db/sql";
import { recordUsageBatch } from "@/server/usage/record-usage";
import type { Paginated } from "@/types/pagination";

export interface ConversationActor {
  workspaceId: string;
  userId: string;
  /** Display name of the acting user; team replies are attributed to it immediately. */
  userName: string;
}

function conversationLabel(conversation: Pick<Conversation, "title">): string {
  return conversation.title?.trim() || "Untitled conversation";
}

/**
 * Resolves the "me" literal against the authenticated caller. The filter is a
 * URL convenience shared by links and bookmarks; the identity behind it always
 * comes from the session, never from the query string.
 */
export function getConversations(
  workspaceId: string,
  filters: ConversationListFilters,
  viewerId: string,
): Promise<Paginated<ConversationListItem>> {
  const assignedTo = filters.assignedTo === "me" ? viewerId : filters.assignedTo;
  return listConversations(workspaceId, { ...filters, assignedTo });
}

export async function getConversation(workspaceId: string, conversationId: string): Promise<Conversation> {
  const conversation = await findConversationDetail(workspaceId, conversationId);
  if (!conversation) throw ApiError.notFound("Conversation not found");
  return conversation;
}

export async function getConversationDetail(workspaceId: string, conversationId: string): Promise<ConversationDetail> {
  const conversation = await getConversation(workspaceId, conversationId);
  const messages = await listConversationMessages(workspaceId, conversationId, CONVERSATION_DETAIL_MESSAGE_LIMIT);
  return { conversation, messages };
}

export function searchLinkableContacts(workspaceId: string, term: string, limit: number): Promise<ContactSearchResult[]> {
  return searchContacts(workspaceId, term, limit);
}

/**
 * Status, assignment and contact linking in one patch. Every id in the payload
 * is re-checked against this workspace before it reaches a column.
 */
export async function updateConversation(
  actor: ConversationActor,
  conversationId: string,
  input: UpdateConversationInput,
): Promise<Conversation> {
  return withWorkspace(actor.workspaceId, async (client) => {
    const existing = await findConversationDetail(actor.workspaceId, conversationId, client);
    if (!existing) throw ApiError.notFound("Conversation not found");

    if (input.contactId) {
      const owned = await contactExists(actor.workspaceId, input.contactId, client);
      if (!owned) throw ApiError.validation({ contactId: ["That contact does not belong to this workspace"] });
    }
    if (input.assignedTo) {
      const member = await isWorkspaceMember(actor.workspaceId, input.assignedTo, client);
      if (!member) throw ApiError.validation({ assignedTo: ["That person is not a member of this workspace"] });
    }

    const patch: ConversationPatch = {
      status: input.status,
      assignedTo: input.assignedTo,
      contactId: input.contactId,
    };
    await updateConversationRow(actor.workspaceId, conversationId, patch, client);

    const updated = await findConversationDetail(actor.workspaceId, conversationId, client);
    if (!updated) throw ApiError.notFound("Conversation not found");
    const label = conversationLabel(updated);

    if (input.status && input.status !== existing.status) {
      await recordActivity(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          entityType: "conversation",
          entityId: conversationId,
          action: `status:${input.status}`,
          summary: `Marked conversation “${label}” as ${input.status}`,
        },
        client,
      );
    }

    // `?? null` because an absent assignee reads as undefined on the record but
    // as an explicit null in the patch; without it, clearing an already empty
    // assignment would log a change that never happened.
    if (input.assignedTo !== undefined && input.assignedTo !== (existing.assignee?.id ?? null)) {
      const assigneeName = updated.assignee?.name ?? null;
      await recordActivity(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          entityType: "conversation",
          entityId: conversationId,
          action: input.assignedTo ? "assigned" : "unassigned",
          summary: assigneeName
            ? `Assigned conversation “${label}” to ${assigneeName}`
            : `Removed the assignee from conversation “${label}”`,
          metadata: { assignedTo: input.assignedTo },
        },
        client,
      );
    }

    if (input.contactId !== undefined && input.contactId !== (existing.contact?.id ?? null)) {
      await recordActivity(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          entityType: "conversation",
          entityId: conversationId,
          action: input.contactId ? "contact_linked" : "contact_unlinked",
          summary: input.contactId
            ? `Linked conversation “${label}” to a contact`
            : `Unlinked the contact from conversation “${label}”`,
          metadata: { contactId: input.contactId },
        },
        client,
      );
    }

    return updated;
  });
}

/**
 * Appends a team member's reply. It is stored as an assistant turn so a later
 * model turn reads a coherent alternating transcript; `author_id` is what makes
 * the inbox render it as "Team".
 */
export async function replyToConversation(
  actor: ConversationActor,
  conversationId: string,
  input: HumanReplyInput,
): Promise<ConversationReplyResult> {
  const existing = await findConversationDetail(actor.workspaceId, conversationId);
  if (!existing) throw ApiError.notFound("Conversation not found");

  const appended = await withWorkspace(actor.workspaceId, async (client) => {
    const created = await appendMessage(
      {
        workspaceId: actor.workspaceId,
        conversationId,
        role: "assistant",
        content: input.content,
        authorId: actor.userId,
      },
      client,
    );
    await recordActivity(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        entityType: "conversation",
        entityId: conversationId,
        action: "replied",
        summary: `Replied to conversation “${conversationLabel(existing)}”`,
      },
      client,
    );
    return created;
  });

  const conversation = await findConversationDetail(actor.workspaceId, conversationId);
  if (!conversation) throw ApiError.notFound("Conversation not found");

  return {
    conversation,
    message: {
      id: appended.id,
      role: "assistant",
      content: input.content,
      sources: null,
      toolCalls: null,
      usage: null,
      author: { id: actor.userId, name: actor.userName },
      createdAt: toIsoRequired(appended.createdAt),
    },
  };
}

/**
 * Generates and stores the AI recap. Summarization is metered work, so the
 * tokens it burns are recorded against the conversation like any model turn.
 */
export async function summarizeConversation(
  actor: ConversationActor,
  conversationId: string,
  signal?: AbortSignal,
): Promise<Conversation> {
  const conversation = await getConversation(actor.workspaceId, conversationId);
  const messages = await listConversationMessages(actor.workspaceId, conversationId, CONVERSATION_DETAIL_MESSAGE_LIMIT);

  const generated = await generateConversationSummary({
    workspaceId: actor.workspaceId,
    conversationId,
    title: conversation.title,
    messages,
    signal,
  });

  const summary: ConversationAiSummary = {
    text: generated.text,
    generatedAt: new Date().toISOString(),
    generatedBy: generated.model,
    // Recorded so the panel can tell the reader that newer turns are not covered.
    messageCount: conversation.messageCount,
  };

  await withWorkspace(actor.workspaceId, async (client) => {
    await saveConversationSummary(actor.workspaceId, conversationId, summary, client);
    await recordActivity(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        entityType: "conversation",
        entityId: conversationId,
        action: "summarized",
        summary: `Summarized conversation “${conversationLabel(conversation)}”`,
        metadata: { model: generated.model },
      },
      client,
    );
  });

  if (generated.usage) {
    await recordUsageBatch(actor.workspaceId, [
      { kind: "tokens_in", quantity: generated.usage.inputTokens, refType: "conversation", refId: conversationId },
      { kind: "tokens_out", quantity: generated.usage.outputTokens, refType: "conversation", refId: conversationId },
    ]);
  }

  return { ...conversation, summary };
}
