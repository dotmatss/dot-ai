"use client";

import { Plug, ShieldAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton, AppButtonLink } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableRow,
} from "@/components/ui/app-table";
import { MCP_SERVER_STATUS_META } from "@/features/mcp/constants";
import { ConnectMcpServerButton } from "@/features/mcp/components/connect-mcp-server-dialog";
import { useDeleteMcpServerMutation } from "@/features/mcp/mutations";
import { useMcpServersQuery } from "@/features/mcp/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";

/**
 * Connected MCP servers.
 *
 * Every row leads to the server's own page, where tools are approved. The
 * count that matters here is not how many tools a server offers but how many
 * have been approved, because an unapproved tool reaches nothing.
 */
export function McpServersPanel() {
  const { membership } = useWorkspace();
  const manageable = canManage(membership.role);
  const query = useMcpServersQuery();
  const remove = useDeleteMcpServerMutation();
  const [confirming, setConfirming] = useState<{ id: string; name: string } | null>(null);

  const base = `/w/${membership.workspace.slug}/integrations/mcp`;

  if (query.isPending) return <AppListSkeleton rows={3} />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const servers = query.data;
  const withStaleGrants = servers.filter((server) => server.staleGrantCount > 0);

  if (servers.length === 0) {
    return (
      <AppTableContainer>
        <AppEmptyState
          icon={<Plug aria-hidden />}
          title="No MCP servers connected"
          description="Connect a remote MCP server to let your agents use the tools it provides. Nothing is available to an agent until you approve it."
          action={manageable ? <ConnectMcpServerButton /> : undefined}
        />
      </AppTableContainer>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {withStaleGrants.length > 0 ? (
        <AppAlert tone="warning" title="Some approvals need reviewing again">
          {withStaleGrants.length === 1
            ? `A tool on “${withStaleGrants[0]!.name}” changed after it was approved, so it is not being offered to your agents until someone reviews it.`
            : `${withStaleGrants.length} servers have tools that changed after they were approved. Those tools are not being offered until someone reviews them.`}
        </AppAlert>
      ) : null}

      <AppTableContainer>
        <AppTable>
          <AppTableHeader>
            <AppTableRow>
              <AppTableHead>Server</AppTableHead>
              <AppTableHead>Status</AppTableHead>
              <AppTableHead className="text-right">Tools</AppTableHead>
              <AppTableHead className="text-right">Approved</AppTableHead>
              <AppTableHead>Last checked</AppTableHead>
              <AppTableHead>
                <span className="sr-only">Actions</span>
              </AppTableHead>
            </AppTableRow>
          </AppTableHeader>
          <AppTableBody>
            {servers.map((server) => {
              const status = MCP_SERVER_STATUS_META[server.status];
              return (
                <AppTableRow key={server.id}>
                  <AppTableCell>
                    <Link
                      href={`${base}/${server.id}` as Route}
                      className="rounded-sm font-medium text-foreground hover:underline hover:underline-offset-4 focus-ring"
                    >
                      {server.name}
                    </Link>
                    <span className="mt-0.5 block font-mono text-caption text-foreground-muted">mcp.{server.slug}</span>
                  </AppTableCell>
                  <AppTableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <AppBadge tone={status.tone} size="sm" dot>
                        {status.label}
                      </AppBadge>
                      {server.hasCredential ? (
                        <AppBadge tone="neutral" size="sm">
                          Credential set
                        </AppBadge>
                      ) : null}
                    </span>
                  </AppTableCell>
                  <AppTableCell className="text-right tabular-nums">{server.toolCount}</AppTableCell>
                  <AppTableCell className="text-right tabular-nums">
                    <span className="inline-flex items-center gap-1.5">
                      {server.grantedToolCount}
                      {server.staleGrantCount > 0 ? (
                        <AppBadge tone="warning" size="sm" icon={<ShieldAlert aria-hidden />}>
                          {server.staleGrantCount} stale
                        </AppBadge>
                      ) : null}
                    </span>
                  </AppTableCell>
                  <AppTableCell className="whitespace-nowrap text-foreground-muted">
                    {server.lastProbeAt ? <AppRelativeTime value={server.lastProbeAt} /> : <span aria-label="Never">&mdash;</span>}
                  </AppTableCell>
                  <AppTableCell className="text-right">
                    <span className="inline-flex gap-2">
                      <AppButtonLink href={`${base}/${server.id}` as Route} variant="secondary" size="sm">
                        Manage
                      </AppButtonLink>
                      {manageable ? (
                        <AppButton
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirming({ id: server.id, name: server.name })}
                        >
                          Disconnect
                        </AppButton>
                      ) : null}
                    </span>
                  </AppTableCell>
                </AppTableRow>
              );
            })}
          </AppTableBody>
        </AppTable>
      </AppTableContainer>

      <AppConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (!confirming) return;
          remove.mutate(confirming.id, { onSuccess: () => setConfirming(null) });
        }}
        title={confirming ? `Disconnect “${confirming.name}”?` : "Disconnect server?"}
        description="Its stored credential, discovered tools and every approval for it are deleted. Agents using its tools will stop being offered them."
        confirmLabel="Disconnect"
        destructive
        loading={remove.isPending}
      />
    </div>
  );
}
