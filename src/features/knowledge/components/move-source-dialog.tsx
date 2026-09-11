"use client";

import { useState } from "react";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppButton } from "@/components/ui/app-button";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppLabel } from "@/components/ui/app-label";
import { AppSelect } from "@/components/ui/app-select";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { useMoveSourceMutation } from "@/features/knowledge/mutations";
import { useCollectionOptionsQuery } from "@/features/knowledge/queries";
import type { KnowledgeSource } from "@/features/knowledge/types";

/**
 * The value a `<select>` uses for "no collection". The empty string is the one
 * value an HTML select cannot hold without colliding with its placeholder, and
 * Unorganized is a real choice here rather than the absence of one.
 */
const UNORGANIZED = "unorganized";

/**
 * Files a document into a collection, or back into Unorganized.
 *
 * A dialog rather than a submenu because the list is as long as the workspace
 * has collections, and a menu of eighty items inside a row's action menu is
 * unusable with a keyboard.
 *
 * Keyed on the document id by `MoveSourceDialog` below, so the selection starts
 * at wherever the document currently lives without an effect writing state on
 * every open — which would cascade a render and, on a slow move, stamp over
 * what the user had already picked.
 */
function MoveDialog({ source, onClose }: { source: KnowledgeSource | null; onClose: () => void }) {
  const options = useCollectionOptionsQuery();
  const move = useMoveSourceMutation();
  const [value, setValue] = useState<string>(source?.collectionId ?? UNORGANIZED);

  const open = Boolean(source);
  const unchanged = (source?.collectionId ?? UNORGANIZED) === value;

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={`Move “${source?.name ?? ""}”`}
      description="Agents can only retrieve from documents that are in a collection they have been given."
      dismissible={!move.isPending}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={move.isPending}>
            Cancel
          </AppButton>
          <AppButton
            loading={move.isPending}
            disabled={unchanged || options.isPending || options.isError}
            onClick={() => {
              if (!source) return;
              move.mutate(
                { sourceId: source.id, collectionId: value === UNORGANIZED ? null : value },
                { onSuccess: onClose },
              );
            }}
          >
            Move
          </AppButton>
        </>
      }
    >
      {options.isPending ? (
        <AppSkeleton className="h-9 w-full" />
      ) : options.isError ? (
        <AppErrorState error={options.error} onRetry={() => void options.refetch()} size="sm" />
      ) : (
        <div className="flex flex-col gap-2">
          <AppLabel htmlFor="move-source-collection">Collection</AppLabel>
          <AppSelect
            id="move-source-collection"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            options={[
              { value: UNORGANIZED, label: "Unorganized" },
              ...options.data.map((option) => ({ value: option.id, label: option.name })),
            ]}
          />
          {value === UNORGANIZED ? (
            <p className="text-xs text-foreground-muted">
              The document stays indexed, but no agent will retrieve from it until it is filed.
            </p>
          ) : null}
        </div>
      )}
    </AppDialog>
  );
}

export function MoveSourceDialog({ source, onClose }: { source: KnowledgeSource | null; onClose: () => void }) {
  // The id is the key, never a timestamp: remounting whenever the row's
  // updatedAt changed would discard the user's choice mid-decision.
  return <MoveDialog key={source?.id ?? "none"} source={source} onClose={onClose} />;
}
