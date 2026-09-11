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
import { KnowledgeBaseStatusBadge } from "@/features/knowledge/components/knowledge-status-badge";
import {
  useDeleteKnowledgeBaseMutation,
  useReprocessKnowledgeBaseMutation,
} from "@/features/knowledge/mutations";
import { useKnowledgeBaseQuery } from "@/features/knowledge/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";
import { formatNumber } from "@/lib/format/number";

export function KnowledgeBaseHeader({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const query = useKnowledgeBaseQuery(knowledgeBaseId);
  const reprocess = useReprocessKnowledgeBaseMutation(knowledgeBaseId);
  const remove = useDeleteKnowledgeBaseMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const base = `/w/${membership.workspace.slug}/knowledge` as Route;

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

  const knowledgeBase = query.data;
  const editable = canEdit(membership.role);
  const summary = [
    `${formatNumber(knowledgeBase.sourceCount)} source${knowledgeBase.sourceCount === 1 ? "" : "s"}`,
    `${formatNumber(knowledgeBase.chunkCount)} passage${knowledgeBase.chunkCount === 1 ? "" : "s"}`,
    `${formatNumber(knowledgeBase.tokenCount)} tokens`,
  ].join(" · ");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Knowledge", href: base }, { label: knowledgeBase.name }]}
        leading={
          <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-foreground-secondary shadow-xs">
            <BookOpen aria-hidden className="size-5" />
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {knowledgeBase.name}
            <KnowledgeBaseStatusBadge status={knowledgeBase.status} />
          </span>
        }
        description={
          <span className="flex flex-col gap-1">
            <span>{knowledgeBase.description ?? "No description yet."}</span>
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
                disabled={knowledgeBase.sourceCount === 0}
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
                    Delete knowledge base
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
        onConfirm={() => remove.mutate(knowledgeBase.id, { onSuccess: () => router.push(base) })}
        title={`Delete “${knowledgeBase.name}”?`}
        description={`Every source and indexed passage is deleted, and ${knowledgeBase.attachedChatbotCount + knowledgeBase.attachedAgentCount} attached chatbot(s) and agent(s) lose this grounding. This cannot be undone.`}
        confirmLabel="Delete knowledge base"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}
