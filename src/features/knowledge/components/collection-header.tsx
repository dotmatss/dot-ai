"use client";

import { BookOpen, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { PageHeader } from "@/components/layout/page-header";
import { AppButton } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppDropdownMenu, AppDropdownMenuItem } from "@/components/ui/app-dropdown-menu";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { CollectionStatusBadge } from "@/features/knowledge/components/knowledge-status-badge";
import {
  useDeleteCollectionMutation,
  useReprocessCollectionMutation,
} from "@/features/knowledge/mutations";
import { useCollectionQuery } from "@/features/knowledge/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";
import { formatNumber } from "@/lib/format/number";

export function CollectionHeader({ collectionId }: { collectionId: string }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const query = useCollectionQuery(collectionId);
  const reprocess = useReprocessCollectionMutation(collectionId);
  const remove = useDeleteCollectionMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const knowledgeHref = `/w/${membership.workspace.slug}/knowledge` as Route;
  const base = `/w/${membership.workspace.slug}/knowledge/collections` as Route;

  if (query.isPending) {
    return (
      <div className="flex items-center gap-4" aria-busy="true">
        <AppSkeleton className="size-12 rounded-lg" />
        <div className="flex flex-col gap-2">
          <AppSkeleton className="h-6 w-56" />
          <AppSkeleton className="h-3 w-40" />
        </div>
      </div>
    );
  }
  if (query.isError) {
    return <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />;
  }

  const collection = query.data;
  const editable = canEdit(membership.role);
  const summary = [
    `${formatNumber(collection.sourceCount)} source${collection.sourceCount === 1 ? "" : "s"}`,
    `${formatNumber(collection.chunkCount)} passage${collection.chunkCount === 1 ? "" : "s"}`,
    `${formatNumber(collection.tokenCount)} tokens`,
  ].join(" · ");

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Knowledge", href: knowledgeHref },
          { label: "Collections", href: base },
          { label: collection.name },
        ]}
        leading={
          <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-foreground-secondary shadow-xs">
            <BookOpen aria-hidden className="size-5" />
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {collection.name}
            <CollectionStatusBadge status={collection.status} />
          </span>
        }
        description={
          <span className="flex flex-col gap-1">
            <span>{collection.description ?? "No description yet."}</span>
            <span className="text-xs text-foreground-subtle">{summary}</span>
          </span>
        }
        actions={
          editable ? (
            <>
              <AppButton
                variant="secondary"
                leadingIcon={<RefreshCw aria-hidden />}
                loading={reprocess.isPending}
                disabled={collection.sourceCount === 0}
                onClick={() => reprocess.mutate()}
              >
                Reprocess all
              </AppButton>
              {canManage(membership.role) ? (
                <AppDropdownMenu
                  label="More actions"
                  trigger={
                    <AppButton variant="secondary" size="icon" aria-label="More actions">
                      <MoreHorizontal aria-hidden />
                    </AppButton>
                  }
                >
                  <AppDropdownMenuItem destructive icon={<Trash2 aria-hidden />} onSelect={() => setConfirmDelete(true)}>
                    Delete collection
                  </AppDropdownMenuItem>
                </AppDropdownMenu>
              ) : null}
            </>
          ) : null
        }
      />
      <AppConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate(collection.id, { onSuccess: () => router.push(base) })}
        title={`Delete “${collection.name}”?`}
        description={`Its ${collection.sourceCount} source(s) are kept and move to Unorganized, but ${collection.attachedChatbotCount + collection.attachedAgentCount} attached chatbot(s) and agent(s) lose this grounding until you file those sources into a collection they use.`}
        confirmLabel="Delete collection"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}
