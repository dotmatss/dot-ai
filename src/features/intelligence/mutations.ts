import { useMutation, useQueryClient } from "@tanstack/react-query";

import { intelligenceApi } from "@/features/intelligence/api";
import { intelligenceKeys } from "@/features/intelligence/queries";
import type { DraftArticleInput, RunAnalysisInput, UpdateTopicInput } from "@/features/intelligence/schemas";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { knowledgeKeys } from "@/features/knowledge/queries";
import { isApiError } from "@/lib/api/api-error";
import { toast } from "@/stores/toast-store";

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

/**
 * Runs an analysis and refreshes everything derived from it.
 *
 * The whole `all()` subtree is invalidated rather than individual keys: a run
 * rewrites the overview, every topic row, every topic's conversations and the
 * run list, so anything narrower would leave part of the screen describing the
 * previous run.
 */
export function useRunAnalysisMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;

  return useMutation({
    mutationFn: (input: RunAnalysisInput) => intelligenceApi.runAnalysis(slug, input),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: intelligenceKeys.all(slug) });
      const analyzed = run.conversationsAnalyzed;
      if (analyzed === 0) {
        toast.info({
          title: "Nothing new to analyze",
          description: "No conversations were started in that window.",
        });
        return;
      }
      toast.success({
        title: "Analysis finished",
        description: `${analyzed.toLocaleString("en")} conversation${analyzed === 1 ? "" : "s"} across ${run.topicsCreated} new topic${run.topicsCreated === 1 ? "" : "s"}.`,
      });
    },
    onError: (error) =>
      toast.error({
        title: "Could not finish the analysis",
        description: errorMessage(error, "Please try again in a moment."),
      }),
  });
}

export function useUpdateTopicMutation(topicId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;

  return useMutation({
    mutationFn: (input: UpdateTopicInput) => intelligenceApi.updateTopic(slug, topicId, input),
    onSuccess: (topic) => {
      queryClient.setQueryData(intelligenceKeys.detail(slug, topicId), topic);
      void queryClient.invalidateQueries({ queryKey: intelligenceKeys.lists(slug) });
      toast.success("Topic updated");
    },
    onError: (error) =>
      toast.error({ title: "Could not update topic", description: errorMessage(error, "Please try again.") }),
  });
}

/**
 * Drafts an article and files it into the knowledge base.
 *
 * It invalidates the KNOWLEDGE keys, not this feature's: the draft creates a
 * knowledge source, and the knowledge screens are the ones now showing stale
 * data. Nothing about the topic itself changed.
 */
export function useDraftArticleMutation(topicId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;

  return useMutation({
    mutationFn: (input: DraftArticleInput) => intelligenceApi.draftArticle(slug, topicId, input),
    onSuccess: (draft) => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.all(slug) });
      toast.success({
        title: "Draft added to Knowledge",
        description: `“${draft.title}” is filed as a draft with the answers left blank.`,
      });
    },
    onError: (error) =>
      toast.error({
        title: "Could not draft the article",
        description: errorMessage(error, "Please try again in a moment."),
      }),
  });
}
