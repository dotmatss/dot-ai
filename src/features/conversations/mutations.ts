import { useMutation, useQueryClient } from "@tanstack/react-query";

import { conversationsApi } from "@/features/conversations/api";
import { CONVERSATION_STATUS_META } from "@/features/conversations/constants";
import { conversationKeys } from "@/features/conversations/queries";
import type { HumanReplyInput, UpdateConversationInput } from "@/features/conversations/schemas";
import type { ConversationDetail } from "@/features/conversations/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { isApiError } from "@/lib/api/api-error";
import { toast } from "@/stores/toast-store";

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

function describeUpdate(input: UpdateConversationInput): string {
  if (input.status) return `Conversation marked ${CONVERSATION_STATUS_META[input.status].label.toLowerCase()}`;
  if (input.assignedTo !== undefined) return input.assignedTo ? "Conversation assigned" : "Assignment cleared";
  if (input.contactId !== undefined) return input.contactId ? "Contact linked" : "Contact unlinked";
  return "Conversation updated";
}

/**
 * Status and assignment changes apply optimistically: they are single-field
 * toggles a reader triages in bursts, and the server response replaces the
 * record anyway. Contact linking is not, because the client has no name for a
 * contact it has only an id for.
 */
export function useUpdateConversationMutation(conversationId: string) {
  const queryClient = useQueryClient();
  const { membership, user } = useWorkspace();
  const slug = membership.workspace.slug;
  const detailKey = conversationKeys.detail(slug, conversationId);

  return useMutation({
    mutationFn: (input: UpdateConversationInput) => conversationsApi.update(slug, conversationId, input),
    onMutate: async (input) => {
      // exact: true - the contact-search queries live under the same prefix and
      // would otherwise be cancelled mid-flight.
      await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
      const previous = queryClient.getQueryData<ConversationDetail>(detailKey);
      if (previous && (input.status || input.assignedTo !== undefined)) {
        const conversation = { ...previous.conversation };
        if (input.status) conversation.status = input.status;
        if (input.assignedTo === null) conversation.assignee = null;
        else if (input.assignedTo === user.id) conversation.assignee = { id: user.id, name: user.name, avatarUrl: user.avatarUrl };
        queryClient.setQueryData<ConversationDetail>(detailKey, { ...previous, conversation });
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(detailKey, context.previous);
      toast.error({ title: "Could not update conversation", description: errorMessage(error, "Please try again.") });
    },
    onSuccess: (conversation, input) => {
      queryClient.setQueryData<ConversationDetail>(detailKey, (current) => (current ? { ...current, conversation } : current));
      toast.success(describeUpdate(input));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: conversationKeys.lists(slug) });
    },
  });
}

export function useReplyToConversationMutation(conversationId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  const detailKey = conversationKeys.detail(slug, conversationId);

  return useMutation({
    mutationFn: (input: HumanReplyInput) => conversationsApi.reply(slug, conversationId, input),
    onSuccess: (result) => {
      queryClient.setQueryData<ConversationDetail>(detailKey, (current) =>
        current ? { conversation: result.conversation, messages: [...current.messages, result.message] } : current,
      );
      void queryClient.invalidateQueries({ queryKey: conversationKeys.lists(slug) });
    },
    onError: (error) => toast.error({ title: "Could not send reply", description: errorMessage(error, "Please try again.") }),
  });
}

export function useSummarizeConversationMutation(conversationId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  const detailKey = conversationKeys.detail(slug, conversationId);

  return useMutation({
    mutationFn: () => conversationsApi.summarize(slug, conversationId),
    onSuccess: (conversation) => {
      queryClient.setQueryData<ConversationDetail>(detailKey, (current) => (current ? { ...current, conversation } : current));
      toast.success("Summary updated");
    },
    onError: (error) => toast.error({ title: "Could not summarize", description: errorMessage(error, "Please try again.") }),
  });
}
