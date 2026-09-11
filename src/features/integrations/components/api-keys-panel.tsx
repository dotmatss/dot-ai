"use client";

import { KeyRound, Ban } from "lucide-react";
import { useMemo, useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppChip } from "@/components/ui/app-chip";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppPagination, paginationSummary } from "@/components/ui/app-pagination";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
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
import { CreateApiKeyButton } from "@/features/integrations/components/create-api-key-dialog";
import { parseApiKeyFilters } from "@/features/integrations/filters";
import { useRevokeApiKeyMutation } from "@/features/integrations/mutations";
import { useApiKeysQuery } from "@/features/integrations/queries";
import type { ApiKey } from "@/features/integrations/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { pageCount } from "@/types/pagination";

const FILTER_KEYS = ["status", "page"] as const;
const COLUMNS = 6;

const STATUS_FILTERS = [
  { value: "active", label: "Active" },
  { value: "revoked", label: "Revoked" },
] as const;

function ApiKeyRow({ apiKey, onRevoke }: { apiKey: ApiKey; onRevoke?: (apiKey: ApiKey) => void }) {
  const revoked = apiKey.revokedAt !== null;
  return (
    <AppTableRow>
      <AppTableCell>
        <span className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
            <KeyRound aria-hidden className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{apiKey.name}</span>
            {apiKey.createdByName ? (
              <span className="block truncate text-xs text-foreground-muted">Created by {apiKey.createdByName}</span>
            ) : null}
          </span>
        </span>
      </AppTableCell>
      <AppTableCell>
        {/* Only the stored display prefix: the rest of the key exists nowhere but the holder's copy. */}
        <code className="font-mono text-xs text-foreground-secondary">{apiKey.keyPrefix}…</code>
      </AppTableCell>
      <AppTableCell>
        {revoked ? (
          <AppBadge tone="danger" dot>
            Revoked
          </AppBadge>
        ) : (
          <AppBadge tone="success" dot>
            Active
          </AppBadge>
        )}
      </AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        <AppRelativeTime value={apiKey.createdAt} />
      </AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        {apiKey.lastUsedAt ? <AppRelativeTime value={apiKey.lastUsedAt} /> : <span>Never used</span>}
      </AppTableCell>
      <AppTableCell className="w-28 text-right">
        {onRevoke && !revoked ? (
          <AppButton variant="ghost" size="sm" onClick={() => onRevoke(apiKey)} leadingIcon={<Ban aria-hidden />}>
            Revoke
            <span className="sr-only"> {apiKey.name}</span>
          </AppButton>
        ) : null}
      </AppTableCell>
    </AppTableRow>
  );
}

export function ApiKeysPanel() {
  const { membership } = useWorkspace();
  const [params, setParams] = useSearchParamState(FILTER_KEYS);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKey | null>(null);
  const revokeMutation = useRevokeApiKeyMutation();

  const filters = useMemo(() => parseApiKeyFilters(params), [params]);
  const query = useApiKeysQuery(filters);
  const hasFilters = Boolean(filters.status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
          <AppChip selected={!filters.status} onClick={() => setParams({ status: undefined })}>
            All
          </AppChip>
          {STATUS_FILTERS.map((option) => (
            <AppChip
              key={option.value}
              selected={filters.status === option.value}
              onClick={() => setParams({ status: filters.status === option.value ? undefined : option.value })}
            >
              {option.label}
            </AppChip>
          ))}
        </div>

        {query.isPending ? (
          <AppListSkeleton rows={4} />
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
                    <AppTableHead>Name</AppTableHead>
                    <AppTableHead>Key</AppTableHead>
                    <AppTableHead>Status</AppTableHead>
                    <AppTableHead>Created</AppTableHead>
                    <AppTableHead>Last used</AppTableHead>
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
                          title="No keys match this filter"
                          description="Clear the filter to see every key in this workspace."
                          action={
                            <AppButton variant="secondary" size="sm" onClick={() => setParams({ status: undefined })}>
                              Clear filters
                            </AppButton>
                          }
                        />
                      ) : (
                        <AppEmptyState
                          icon={<KeyRound aria-hidden />}
                          title="Create your first API key"
                          description="API keys let your own servers, Zapier and other tools call the public API on behalf of this workspace."
                          action={<CreateApiKeyButton size="sm" />}
                        />
                      )}
                    </AppTableMessageRow>
                  ) : (
                    query.data.items.map((apiKey) => (
                      <ApiKeyRow
                        key={apiKey.id}
                        apiKey={apiKey}
                        onRevoke={canManage(membership.role) ? setPendingRevoke : undefined}
                      />
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
      </div>

      <AppConfirmDialog
        open={Boolean(pendingRevoke)}
        onClose={() => setPendingRevoke(null)}
        onConfirm={() => {
          if (!pendingRevoke) return;
          revokeMutation.mutate(pendingRevoke.id, { onSettled: () => setPendingRevoke(null) });
        }}
        title={`Revoke “${pendingRevoke?.name ?? ""}”?`}
        description="Any integration using this key stops working immediately. Revocation is permanent - issue a new key to restore access."
        confirmLabel="Revoke key"
        destructive
        loading={revokeMutation.isPending}
      />
    </div>
  );
}
