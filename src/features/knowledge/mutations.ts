import { useMutation, useQueryClient } from "@tanstack/react-query";

import { knowledgeApi } from "@/features/knowledge/api";
import { knowledgeKeys } from "@/features/knowledge/queries";
import type {
  CreateKnowledgeBaseInput,
  CreateSourceInput,
  KnowledgeSearchInput,
  UpdateKnowledgeBaseInput,
} from "@/features/knowledge/schemas";
import type { KnowledgeBase, KnowledgeSource } from "@/features/knowledge/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { isApiError } from "@/lib/api/api-error";
import { toast } from "@/stores/toast-store";

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

/** A finished source may still have failed; the toast has to say which. */
function reportSourceOutcome(source: KnowledgeSource, successTitle: string) {
  if (source.status === "failed") {
    toast.error({ title: `“${source.name}” could not be processed`, description: source.error ?? "Try again." });
    return;
  }
  toast.success({
    title: successTitle,
    description: `${source.chunkCount} passage${source.chunkCount === 1 ? "" : "s"} indexed.`,
  });
}

export function useCreateKnowledgeBaseMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: CreateKnowledgeBaseInput) => knowledgeApi.create(slug, input),
    onSuccess: (base) => {
      queryClient.setQueryData(knowledgeKeys.detail(slug, base.id), base);
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists(slug) });
      toast.success({ title: "Knowledge base created", description: `Add sources to ${base.name} to make it searchable.` });
    },
    onError: (error) =>
      toast.error({ title: "Could not create knowledge base", description: errorMessage(error, "Please try again.") }),
  });
}

export function useUpdateKnowledgeBaseMutation(knowledgeBaseId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  const detailKey = knowledgeKeys.detail(slug, knowledgeBaseId);

  return useMutation({
    mutationFn: (input: UpdateKnowledgeBaseInput) => knowledgeApi.update(slug, knowledgeBaseId, input),
    onMutate: async (input) => {
      // The name is echoed in the header and breadcrumb, so it is worth showing
      // immediately; everything else waits for the server.
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<KnowledgeBase>(detailKey);
      if (previous && input.name) {
        queryClient.setQueryData<KnowledgeBase>(detailKey, { ...previous, name: input.name });
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(detailKey, context.previous);
      toast.error({ title: "Could not save changes", description: errorMessage(error, "Please try again.") });
    },
    onSuccess: (base) => {
      queryClient.setQueryData(detailKey, base);
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists(slug) });
      toast.success("Changes saved");
    },
  });
}

export function useDeleteKnowledgeBaseMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (knowledgeBaseId: string) => knowledgeApi.remove(slug, knowledgeBaseId),
    onSuccess: (_result, knowledgeBaseId) => {
      queryClient.removeQueries({ queryKey: knowledgeKeys.detail(slug, knowledgeBaseId) });
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists(slug) });
      toast.success("Knowledge base deleted");
    },
    onError: (error) =>
      toast.error({ title: "Could not delete knowledge base", description: errorMessage(error, "Please try again.") }),
  });
}

export function useReprocessKnowledgeBaseMutation(knowledgeBaseId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: () => knowledgeApi.reprocess(slug, knowledgeBaseId),
    onSuccess: (base) => {
      queryClient.setQueryData(knowledgeKeys.detail(slug, knowledgeBaseId), base);
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.sources(slug, knowledgeBaseId) });
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists(slug) });
      if (base.failedSourceCount > 0) {
        toast.error({
          title: "Reprocessing finished with errors",
          description: `${base.failedSourceCount} of ${base.sourceCount} sources failed.`,
        });
        return;
      }
      toast.success({ title: "Reprocessing finished", description: `${base.chunkCount} passages indexed.` });
    },
    onError: (error) => toast.error({ title: "Could not reprocess", description: errorMessage(error, "Please try again.") }),
  });
}

/** Invalidates everything a finished pipeline run can change. */
function useSourceInvalidation(knowledgeBaseId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return () => {
    void queryClient.invalidateQueries({ queryKey: knowledgeKeys.sources(slug, knowledgeBaseId) });
    void queryClient.invalidateQueries({ queryKey: knowledgeKeys.detail(slug, knowledgeBaseId) });
    void queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists(slug) });
  };
}

export function useCreateSourceMutation(knowledgeBaseId: string) {
  const { membership } = useWorkspace();
  const invalidate = useSourceInvalidation(knowledgeBaseId);
  return useMutation({
    mutationFn: (input: CreateSourceInput) =>
      knowledgeApi.createSource(membership.workspace.slug, knowledgeBaseId, input),
    onSuccess: (source) => {
      invalidate();
      reportSourceOutcome(source, "Source added");
    },
    onError: (error) => toast.error({ title: "Could not add source", description: errorMessage(error, "Please try again.") }),
  });
}

export function useUploadSourceMutation(knowledgeBaseId: string) {
  const { membership } = useWorkspace();
  const invalidate = useSourceInvalidation(knowledgeBaseId);
  return useMutation({
    mutationFn: (file: File) => knowledgeApi.uploadSource(membership.workspace.slug, knowledgeBaseId, file),
    onSuccess: (source) => {
      invalidate();
      reportSourceOutcome(source, "File uploaded");
    },
    onError: (error) => toast.error({ title: "Could not upload file", description: errorMessage(error, "Please try again.") }),
  });
}

export function useReprocessSourceMutation(knowledgeBaseId: string) {
  const { membership } = useWorkspace();
  const invalidate = useSourceInvalidation(knowledgeBaseId);
  return useMutation({
    mutationFn: (sourceId: string) =>
      knowledgeApi.reprocessSource(membership.workspace.slug, knowledgeBaseId, sourceId),
    onSuccess: (source) => {
      invalidate();
      reportSourceOutcome(source, "Source reprocessed");
    },
    onError: (error) => toast.error({ title: "Could not reprocess source", description: errorMessage(error, "Please try again.") }),
  });
}

export function useDeleteSourceMutation(knowledgeBaseId: string) {
  const { membership } = useWorkspace();
  const invalidate = useSourceInvalidation(knowledgeBaseId);
  return useMutation({
    mutationFn: (sourceId: string) => knowledgeApi.removeSource(membership.workspace.slug, knowledgeBaseId, sourceId),
    onSuccess: () => {
      invalidate();
      toast.success("Source removed");
    },
    onError: (error) => toast.error({ title: "Could not remove source", description: errorMessage(error, "Please try again.") }),
  });
}

export function useKnowledgeSearchMutation(knowledgeBaseId: string) {
  const { membership } = useWorkspace();
  return useMutation({
    mutationFn: (input: KnowledgeSearchInput) =>
      knowledgeApi.search(membership.workspace.slug, knowledgeBaseId, input),
  });
}
