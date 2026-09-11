"use client";

import { Archive, Bot, FlaskConical, MoreHorizontal, Pause, Play, Trash2 } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { PageHeader } from "@/components/layout/page-header";
import { AppButton, AppButtonLink } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppDropdownMenu, AppDropdownMenuItem, AppDropdownMenuSeparator } from "@/components/ui/app-dropdown-menu";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { ChatbotStatusBadge } from "@/features/chatbots/components/chatbot-status-badge";
import { useDeleteChatbotMutation, useUpdateChatbotMutation } from "@/features/chatbots/mutations";
import { useChatbotQuery } from "@/features/chatbots/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";

export function ChatbotHeader({ chatbotId }: { chatbotId: string }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const query = useChatbotQuery(chatbotId);
  const update = useUpdateChatbotMutation(chatbotId, { silent: true });
  const remove = useDeleteChatbotMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const base = `/w/${membership.workspace.slug}/chatbots` as Route;

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

  const chatbot = query.data;
  const editable = canEdit(membership.role);

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Chatbots", href: base },
          { label: chatbot.name },
        ]}
        leading={
          <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-foreground-secondary shadow-xs">
            <Bot aria-hidden className="size-5" />
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {chatbot.name}
            <ChatbotStatusBadge status={chatbot.status} />
          </span>
        }
        description={chatbot.description ?? "No description yet."}
        actions={
          <>
            <AppButtonLink href={`${base}/${chatbot.id}/playground` as Route} variant="secondary" leadingIcon={<FlaskConical aria-hidden />}>
              Test
            </AppButtonLink>
            {editable ? (
              chatbot.status === "active" ? (
                <AppButton
                  variant="secondary"
                  leadingIcon={<Pause aria-hidden />}
                  loading={update.isPending}
                  onClick={() => update.mutate({ status: "paused" })}
                >
                  Pause
                </AppButton>
              ) : (
                <AppButton leadingIcon={<Play aria-hidden />} loading={update.isPending} onClick={() => update.mutate({ status: "active" })}>
                  {chatbot.status === "draft" ? "Activate" : "Resume"}
                </AppButton>
              )
            ) : null}
            {editable ? (
              <AppDropdownMenu
                label="More actions"
                trigger={
                  <AppButton variant="secondary" size="icon" aria-label="More actions">
                    <MoreHorizontal aria-hidden />
                  </AppButton>
                }
              >
                {chatbot.status !== "archived" ? (
                  <AppDropdownMenuItem icon={<Archive aria-hidden />} onSelect={() => update.mutate({ status: "archived" })}>
                    Archive
                  </AppDropdownMenuItem>
                ) : (
                  <AppDropdownMenuItem icon={<Play aria-hidden />} onSelect={() => update.mutate({ status: "draft" })}>
                    Restore to draft
                  </AppDropdownMenuItem>
                )}
                {canManage(membership.role) ? (
                  <>
                    <AppDropdownMenuSeparator />
                    <AppDropdownMenuItem destructive icon={<Trash2 aria-hidden />} onSelect={() => setConfirmDelete(true)}>
                      Delete chatbot
                    </AppDropdownMenuItem>
                  </>
                ) : null}
              </AppDropdownMenu>
            ) : null}
          </>
        }
      />
      <AppConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          remove.mutate(chatbot.id, {
            onSuccess: () => router.push(base),
          })
        }
        title={`Delete “${chatbot.name}”?`}
        description="The embed stops working immediately and configuration is removed. Conversations are kept for reporting. This cannot be undone."
        confirmLabel="Delete chatbot"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}
