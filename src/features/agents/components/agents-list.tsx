"use client";

import { Cpu, FlaskConical, MoreHorizontal, ShieldCheck, Trash2, Wrench } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppChip } from "@/components/ui/app-chip";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppDropdownMenu, AppDropdownMenuItem } from "@/components/ui/app-dropdown-menu";
import { AppSearchInput } from "@/components/ui/app-input";
import { AppPagination, paginationSummary } from "@/components/ui/app-pagination";
import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableMessageRow,
  AppTableRow,
} from "@/components/ui/app-table";
import { AgentStatusBadge } from "@/features/agents/components/agent-status-badge";
import { CreateAgentButton } from "@/features/agents/components/create-agent-dialog";
import { AGENT_STATUS_META } from "@/features/agents/constants";
import { parseAgentFilters } from "@/features/agents/filters";
import { useDeleteAgentMutation } from "@/features/agents/mutations";
import { useAgentsQuery } from "@/features/agents/queries";
import { AGENT_STATUSES, type AgentSummary } from "@/features/agents/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { pageCount } from "@/types/pagination";
import { AppRelativeTime } from "@/components/ui/app-relative-time";

const FILTER_KEYS = ["q", "status", "page"] as const;
const COLUMNS = 6;

function AgentRow({ agent, onDelete }: { agent: AgentSummary; onDelete?: (agent: AgentSummary) => void }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const href = `/w/${membership.workspace.slug}/agents/${agent.id}` as Route;
  return (
    <AppTableRow>
      <AppTableCell>
        <Link href={href} className="group flex items-center gap-3 rounded-md focus-ring">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
            <Cpu aria-hidden className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground group-hover:underline group-hover:underline-offset-4">{agent.name}</span>
            {agent.description ? <span className="block max-w-md truncate text-xs text-foreground-muted">{agent.description}</span> : null}
          </span>
        </Link>
      </AppTableCell>
      <AppTableCell>
        <span className="flex flex-wrap items-center gap-1.5">
          <AgentStatusBadge status={agent.status} />
          {agent.requiresApproval ? (
            <AppBadge tone="warning" size="sm" icon={<ShieldCheck aria-hidden />}>
              Approval
            </AppBadge>
          ) : null}
        </span>
      </AppTableCell>
      <AppTableCell className="tabular-nums">
        <span className="inline-flex items-center gap-1.5 text-foreground-secondary">
          <Wrench aria-hidden className="size-3.5 text-foreground-subtle" />
          {agent.enabledToolCount}
        </span>
      </AppTableCell>
      <AppTableCell className="tabular-nums">{agent.knowledgeBaseCount}</AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        <AppRelativeTime value={agent.updatedAt} />
      </AppTableCell>
      <AppTableCell className="w-12 text-right">
        <AppDropdownMenu
          label={`Actions for ${agent.name}`}
          trigger={
            <AppButton variant="ghost" size="icon-sm" aria-label={`Actions for ${agent.name}`}>
              <MoreHorizontal aria-hidden />
            </AppButton>
          }
        >
          <AppDropdownMenuItem icon={<Cpu aria-hidden />} onSelect={() => router.push(href)}>
            Open
          </AppDropdownMenuItem>
          <AppDropdownMenuItem icon={<FlaskConical aria-hidden />} onSelect={() => router.push(`${href}/playground` as Route)}>
            Test in playground
          </AppDropdownMenuItem>
          {onDelete ? (
            <AppDropdownMenuItem destructive icon={<Trash2 aria-hidden />} onSelect={() => onDelete(agent)}>
              Delete
            </AppDropdownMenuItem>
          ) : null}
        </AppDropdownMenu>
      </AppTableCell>
    </AppTableRow>
  );
}

export function AgentsList() {
  const { membership } = useWorkspace();
  const [params, setParams] = useSearchParamState(FILTER_KEYS);
  const [search, setSearch] = useState(params.q ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [pendingDelete, setPendingDelete] = useState<AgentSummary | null>(null);
  const deleteMutation = useDeleteAgentMutation();

  // Persist the debounced search term in the URL so it survives reloads.
  useEffect(() => {
    const current = params.q ?? "";
    if (debouncedSearch !== current) setParams({ q: debouncedSearch || undefined });
  }, [debouncedSearch, params.q, setParams]);

  const filters = useMemo(() => parseAgentFilters({ ...params, q: debouncedSearch || undefined }), [params, debouncedSearch]);
  const query = useAgentsQuery(filters);
  const hasFilters = Boolean(filters.q || filters.status);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <AppSearchInput value={search} onValueChange={setSearch} placeholder="Search agents…" aria-label="Search agents" />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
          <AppChip selected={!filters.status} onClick={() => setParams({ status: undefined })}>
            All
          </AppChip>
          {AGENT_STATUSES.map((status) => (
            <AppChip
              key={status}
              selected={filters.status === status}
              onClick={() => setParams({ status: filters.status === status ? undefined : status })}
            >
              {AGENT_STATUS_META[status].label}
            </AppChip>
          ))}
        </div>
      </div>

      {query.isPending ? (
        <AppListSkeleton rows={5} />
      ) : query.isError ? (
        <AppTableContainer>
          <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />
        </AppTableContainer>
      ) : (
        <>
          <AppTableContainer aria-busy={query.isFetching || undefined}>
            <AppTable>
              <AppTableHeader>
                <AppTableRow>
                  <AppTableHead>Agent</AppTableHead>
                  <AppTableHead>Status</AppTableHead>
                  <AppTableHead>Tools</AppTableHead>
                  <AppTableHead>Knowledge</AppTableHead>
                  <AppTableHead>Updated</AppTableHead>
                  <AppTableHead>
                    <span className="sr-only">Actions</span>
                  </AppTableHead>
                </AppTableRow>
              </AppTableHeader>
              <AppTableBody>
                {query.data.items.length === 0 ? (
                  <AppTableMessageRow colSpan={COLUMNS}>
                    {hasFilters ? (
                      <AppEmptyState
                        size="sm"
                        title="No agents match your filters"
                        description="Try a different search term or clear the filters."
                        action={
                          <AppButton
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setSearch("");
                              setParams({ q: undefined, status: undefined });
                            }}
                          >
                            Clear filters
                          </AppButton>
                        }
                      />
                    ) : (
                      <AppEmptyState
                        icon={<Cpu aria-hidden />}
                        title="Create your first agent"
                        description="Agents follow your instructions, use tools, read your knowledge bases and can pause for human approval before they act."
                        action={<CreateAgentButton />}
                      />
                    )}
                  </AppTableMessageRow>
                ) : (
                  query.data.items.map((agent) => (
                    <AgentRow key={agent.id} agent={agent} onDelete={canManage(membership.role) ? setPendingDelete : undefined} />
                  ))
                )}
              </AppTableBody>
            </AppTable>
          </AppTableContainer>
          <AppPagination
            page={query.data.page}
            pageCount={pageCount(query.data.total, query.data.pageSize)}
            onPageChange={(page) => setParams({ page: page > 1 ? page : undefined }, { resetPage: false })}
            summary={paginationSummary(query.data.page, query.data.pageSize, query.data.total)}
          />
        </>
      )}

      <AppConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteMutation.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
        }}
        title={`Delete “${pendingDelete?.name ?? ""}”?`}
        description="Conversations linked to this agent are kept, but its instructions, tools and knowledge links are removed. This cannot be undone."
        confirmLabel="Delete agent"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
