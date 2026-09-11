import { useMutation, useQueryClient } from "@tanstack/react-query";

import { chatbotsApi } from "@/features/chatbots/api";
import { chatbotKeys } from "@/features/chatbots/queries";
import type { CreateChatbotInput, UpdateChatbotInput } from "@/features/chatbots/schemas";
import type { Chatbot } from "@/features/chatbots/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { isApiError } from "@/lib/api/api-error";
import { toast } from "@/stores/toast-store";

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

export function useCreateChatbotMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: CreateChatbotInput) => chatbotsApi.create(slug, input),
    onSuccess: (chatbot) => {
      queryClient.setQueryData(chatbotKeys.detail(slug, chatbot.id), chatbot);
      void queryClient.invalidateQueries({ queryKey: chatbotKeys.lists(slug) });
      toast.success({ title: "Chatbot created", description: `${chatbot.name} is ready to configure.` });
    },
    onError: (error) => toast.error({ title: "Could not create chatbot", description: errorMessage(error, "Please try again.") }),
  });
}

export function useUpdateChatbotMutation(chatbotId: string, options: { silent?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  const detailKey = chatbotKeys.detail(slug, chatbotId);

  return useMutation({
    mutationFn: (input: UpdateChatbotInput) => chatbotsApi.update(slug, chatbotId, input),
    onMutate: async (input) => {
      // Optimistic update for lightweight fields (status, name) so toggles feel instant.
      // exact: true - the knowledge and overview queries live under this key
      // prefix and would otherwise be cancelled and left pending forever.
      await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
      const previous = queryClient.getQueryData<Chatbot>(detailKey);
      if (previous && (input.status || input.name)) {
        queryClient.setQueryData<Chatbot>(detailKey, {
          ...previous,
          ...(input.status ? { status: input.status } : {}),
          ...(input.name ? { name: input.name } : {}),
        });
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(detailKey, context.previous);
      toast.error({ title: "Could not save changes", description: errorMessage(error, "Please try again.") });
    },
    onSuccess: (chatbot) => {
      queryClient.setQueryData(detailKey, chatbot);
      void queryClient.invalidateQueries({ queryKey: chatbotKeys.lists(slug) });
      void queryClient.invalidateQueries({ queryKey: chatbotKeys.knowledge(slug, chatbotId) });
      if (!options.silent) toast.success("Changes saved");
    },
  });
}

export function useDeleteChatbotMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (chatbotId: string) => chatbotsApi.remove(slug, chatbotId),
    onSuccess: (_result, chatbotId) => {
      queryClient.removeQueries({ queryKey: chatbotKeys.detail(slug, chatbotId) });
      void queryClient.invalidateQueries({ queryKey: chatbotKeys.lists(slug) });
      toast.success("Chatbot deleted");
    },
    onError: (error) => toast.error({ title: "Could not delete chatbot", description: errorMessage(error, "Please try again.") }),
  });
}
