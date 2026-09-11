"use client";

import { Archive, Cpu, FlaskConical, MoreHorizontal, Pause, Pencil, Play, ShieldCheck, Trash2 } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { PageHeader } from "@/components/layout/page-header";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton, AppButtonLink } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppDropdownMenu, AppDropdownMenuItem, AppDropdownMenuSeparator } from "@/components/ui/app-dropdown-menu";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AgentStatusBadge } from "@/features/agents/components/agent-status-badge";
import { useDeleteAgentMutation, useUpdateAgentMutation } from "@/features/agents/mutations";
import { useAgentQuery } from "@/features/agents/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";

export function AgentHeader({ agentId }: { agentId: string }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const query = useAgentQuery(agentId);
  const update = useUpdateAgentMutation(agentId, { silent: true });
  const remove = useDeleteAgentMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const base = `/w/${membership.workspace.slug}/agents` as Route;

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

  const agent = query.data;
  const editable = canEdit(membership.role);
  const canActivate = agent.instructions.trim().length > 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Agents", href: base }, { label: agent.name }]}
        leading={
          <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-foreground-secondary shadow-xs">
            <Cpu aria-hidden className="size-5" />
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {agent.name}
            <AgentStatusBadge status={agent.status} />
            {agent.requiresApproval ? (
              <AppBadge tone="warning" icon={<ShieldCheck aria-hidden />}>
                Approval required
              </AppBadge>
            ) : null}
          </span>
        }
        description={agent.description ?? "No description yet."}
        actions={
          <>
            <AppButtonLink href={`${base}/${agent.id}/playground` as Route} variant="secondary" leadingIcon={<FlaskConical aria-hidden />}>
              Test
            </AppButtonLink>
            {editable ? (
              agent.status === "active" ? (
                <AppButton
                  variant="secondary"
                  leadingIcon={<Pause aria-hidden />}
                  loading={update.isPending}
                  onClick={() => update.mutate({ status: "paused" })}
                >
                  Pause
                </AppButton>
              ) : canActivate ? (
                <AppButton leadingIcon={<Play aria-hidden />} loading={update.isPending} onClick={() => update.mutate({ status: "active" })}>
                  {agent.status === "draft" ? "Activate" : "Resume"}
                </AppButton>
              ) : (
                // The server refuses to activate an agent with no instructions, so
                // offer the step that unblocks it instead of a dead control.
                <AppButtonLink href={`${base}/${agent.id}/instructions` as Route} leadingIcon={<Pencil aria-hidden />}>
                  Write instructions
                </AppButtonLink>
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
                {agent.status !== "archived" ? (
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
                      Delete agent
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
        onConfirm={() => remove.mutate(agent.id, { onSuccess: () => router.push(base) })}
        title={`Delete “${agent.name}”?`}
        description="Instructions, tools, memory settings and knowledge links are removed immediately. Conversations are kept for reporting. This cannot be undone."
        confirmLabel="Delete agent"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}
