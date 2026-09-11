import { useMutation, useQueryClient } from "@tanstack/react-query";

import { knowledgeApi } from "@/features/knowledge/api";
import { knowledgeKeys } from "@/features/knowledge/queries";
import type {
  CreateCollectionInput,
  CreateSourceInput,
  KnowledgeSearchInput,
  MoveSourceInput,
  UpdateCollectionInput,
} from "@/features/knowledge/schemas";
import type { Collection, KnowledgeSource } from "@/features/knowledge/types";
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
    description: source.collectionName
      ? `${source.chunkCount} passage${source.chunkCount === 1 ? "" : "s"} indexed in ${source.collectionName}.`
      : `${source.chunkCount} passage${source.chunkCount === 1 ? "" : "s"} indexed. File it into a collection to let agents use it.`,
  });
}

/* -------------------------------------------------------------------------- */
/* Collections                                                                */
/* -------------------------------------------------------------------------- */

export function useCreateCollectionMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: CreateCollectionInput) => knowledgeApi.createCollection(slug, input),
    onSuccess: (collection) => {
      queryClient.setQueryData(knowledgeKeys.collection(slug, collection.id), collection);
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.collections(slug) });
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.overview(slug) });
      toast.success({ title: "Collection created", description: `Add sources to ${collection.name} to make it searchable.` });
    },
    onError: (error) =>
      toast.error({ title: "Could not create collection", description: errorMessage(error, "Please try again.") }),
  });
}

export function useUpdateCollectionMutation(collectionId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  const detailKey = knowledgeKeys.collection(slug, collectionId);

  return useMutation({
    mutationFn: (input: UpdateCollectionInput) => knowledgeApi.updateCollection(slug, collectionId, input),
    onMutate: async (input) => {
      // The name is echoed in the header and breadcrumb, so it is worth showing
      // immediately; everything else waits for the server.
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<Collection>(detailKey);
      if (previous && input.name) {
        queryClient.setQueryData<Collection>(detailKey, { ...previous, name: input.name });
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(detailKey, context.previous);
      toast.error({ title: "Could not save changes", description: errorMessage(error, "Please try again.") });
    },
    onSuccess: (collection) => {
      queryClient.setQueryData(detailKey, collection);
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.collectionLists(slug) });
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.overview(slug) });
      toast.success("Changes saved");
    },
  });
}

export function useDeleteCollectionMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (collectionId: string) => knowledgeApi.removeCollection(slug, collectionId),
    onSuccess: (_result, collectionId) => {
      queryClient.removeQueries({ queryKey: knowledgeKeys.collection(slug, collectionId) });
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.collections(slug) });
      // Its documents are now unorganized, so every source listing is stale.
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.sources(slug) });
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.overview(slug) });
      toast.success({ title: "Collection deleted", description: "Its sources moved to Unorganized." });
    },
    onError: (error) =>
      toast.error({ title: "Could not delete collection", description: errorMessage(error, "Please try again.") }),
  });
}

export function useReprocessCollectionMutation(collectionId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: () => knowledgeApi.reprocessCollection(slug, collectionId),
    onSuccess: (collection) => {
      queryClient.setQueryData(knowledgeKeys.collection(slug, collectionId), collection);
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.sources(slug) });
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.collectionLists(slug) });
      if (collection.failedSourceCount > 0) {
        toast.error({
          title: "Reprocessing finished with errors",
          description: `${collection.failedSourceCount} of ${collection.sourceCount} sources failed.`,
        });
        return;
      }
      toast.success({ title: "Reprocessing finished", description: `${collection.chunkCount} passages indexed.` });
    },
    onError: (error) => toast.error({ title: "Could not reprocess", description: errorMessage(error, "Please try again.") }),
  });
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Invalidates everything a finished pipeline run can change.
 *
 * Every source listing is invalidated, not just the one in view: a document can
 * be added from the collection page and is simultaneously part of All Knowledge,
 * and a move changes two listings at once.
 */
function useSourceInvalidation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return () => {
    void queryClient.invalidateQueries({ queryKey: knowledgeKeys.sources(slug) });
    void queryClient.invalidateQueries({ queryKey: knowledgeKeys.collections(slug) });
    void queryClient.invalidateQueries({ queryKey: knowledgeKeys.overview(slug) });
  };
}

export function useCreateSourceMutation(collectionId: string | null) {
  const { membership } = useWorkspace();
  const invalidate = useSourceInvalidation();
  return useMutation({
    mutationFn: (input: CreateSourceInput) => knowledgeApi.createSource(membership.workspace.slug, collectionId, input),
    onSuccess: (source) => {
      invalidate();
      reportSourceOutcome(source, "Source added");
    },
    onError: (error) => toast.error({ title: "Could not add source", description: errorMessage(error, "Please try again.") }),
  });
}

export function useUploadSourceMutation(collectionId: string | null) {
  const { membership } = useWorkspace();
  const invalidate = useSourceInvalidation();
  return useMutation({
    mutationFn: (file: File) => knowledgeApi.uploadSource(membership.workspace.slug, collectionId, file),
    onSuccess: (source) => {
      invalidate();
      reportSourceOutcome(source, "File uploaded");
    },
    onError: (error) => toast.error({ title: "Could not upload file", description: errorMessage(error, "Please try again.") }),
  });
}

export function useReprocessSourceMutation() {
  const { membership } = useWorkspace();
  const invalidate = useSourceInvalidation();
  return useMutation({
    mutationFn: (sourceId: string) => knowledgeApi.reprocessSource(membership.workspace.slug, sourceId),
    onSuccess: (source) => {
      invalidate();
      reportSourceOutcome(source, "Source reprocessed");
    },
    onError: (error) => toast.error({ title: "Could not reprocess source", description: errorMessage(error, "Please try again.") }),
  });
}

/** Filing a document into a collection, or back into Unorganized with a null id. */
export function useMoveSourceMutation() {
  const { membership } = useWorkspace();
  const invalidate = useSourceInvalidation();
  return useMutation({
    mutationFn: ({ sourceId, ...input }: MoveSourceInput & { sourceId: string }) =>
      knowledgeApi.moveSource(membership.workspace.slug, sourceId, input),
    onSuccess: (source) => {
      invalidate();
      toast.success(
        source.collectionName ? `Filed into ${source.collectionName}` : "Moved to Unorganized",
      );
    },
    onError: (error) => toast.error({ title: "Could not move source", description: errorMessage(error, "Please try again.") }),
  });
}

export function useDeleteSourceMutation() {
  const { membership } = useWorkspace();
  const invalidate = useSourceInvalidation();
  return useMutation({
    mutationFn: (sourceId: string) => knowledgeApi.removeSource(membership.workspace.slug, sourceId),
    onSuccess: () => {
      invalidate();
      toast.success("Source removed");
    },
    onError: (error) => toast.error({ title: "Could not remove source", description: errorMessage(error, "Please try again.") }),
  });
}

export function useKnowledgeSearchMutation(collectionId: string) {
  const { membership } = useWorkspace();
  return useMutation({
    mutationFn: (input: KnowledgeSearchInput) => knowledgeApi.search(membership.workspace.slug, collectionId, input),
  });
}
