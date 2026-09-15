"use client";

import { KeyRound, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
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
import {
  AddCredentialButton,
  CredentialDialog,
  useCredentialDialog,
} from "@/features/integrations/components/credential-dialog";
import { CREDENTIAL_TYPE_META } from "@/features/integrations/constants";
import { parseCredentialFilters } from "@/features/integrations/filters";
import { useDeleteCredentialMutation } from "@/features/integrations/mutations";
import { useCredentialsQuery } from "@/features/integrations/queries";
import { CREDENTIAL_TYPES, type Credential } from "@/features/integrations/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { pageCount } from "@/types/pagination";

const FILTER_KEYS = ["type", "page"] as const;
const COLUMNS = 5;

function CredentialRow({
  credential,
  onEdit,
  onDelete,
}: {
  credential: Credential;
  onEdit?: (credential: Credential) => void;
  onDelete?: (credential: Credential) => void;
}) {
  return (
    <AppTableRow>
      <AppTableCell>
        <span className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
            <KeyRound aria-hidden className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{credential.name}</span>
            {credential.createdByName ? (
              <span className="block truncate text-xs text-foreground-muted">Added by {credential.createdByName}</span>
            ) : null}
          </span>
        </span>
      </AppTableCell>
      <AppTableCell className="text-foreground-secondary">{CREDENTIAL_TYPE_META[credential.type].label}</AppTableCell>
      <AppTableCell>
        {/* The header NAME, never the value: no endpoint returns the value, so
            there is nothing here that could leak one. */}
        <code className="font-mono text-xs text-foreground-secondary">{credential.headerPreview}</code>
      </AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        {credential.lastUsedAt ? <AppRelativeTime value={credential.lastUsedAt} /> : <span>Never used</span>}
      </AppTableCell>
      <AppTableCell className="w-32 text-right">
        {onEdit || onDelete ? (
          <span className="flex justify-end gap-1">
            {onEdit ? (
              <AppButton variant="ghost" size="sm" onClick={() => onEdit(credential)} leadingIcon={<Pencil aria-hidden />}>
                Edit
                <span className="sr-only"> {credential.name}</span>
              </AppButton>
            ) : null}
            {onDelete ? (
              <AppButton
                variant="ghost"
                size="sm"
                onClick={() => onDelete(credential)}
                leadingIcon={<Trash2 aria-hidden />}
              >
                <span className="sr-only">Delete {credential.name}</span>
              </AppButton>
            ) : null}
          </span>
        ) : null}
      </AppTableCell>
    </AppTableRow>
  );
}

export function CredentialsPanel() {
  const { membership } = useWorkspace();
  const [params, setParams] = useSearchParamState(FILTER_KEYS);
  const [pendingDelete, setPendingDelete] = useState<Credential | null>(null);
  const deleteMutation = useDeleteCredentialMutation();
  const dialog = useCredentialDialog();

  const filters = useMemo(() => parseCredentialFilters(params), [params]);
  const query = useCredentialsQuery(filters);
  const hasFilters = Boolean(filters.type);
  const editable = canManage(membership.role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by type">
          <AppChip selected={!filters.type} onClick={() => setParams({ type: undefined })}>
            All
          </AppChip>
          {CREDENTIAL_TYPES.map((type) => (
            <AppChip
              key={type}
              selected={filters.type === type}
              onClick={() => setParams({ type: filters.type === type ? undefined : type })}
            >
              {CREDENTIAL_TYPE_META[type].label}
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
                    <AppTableHead>Type</AppTableHead>
                    <AppTableHead>Sets header</AppTableHead>
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
                          title="No credentials match this filter"
                          description="Clear the filter to see every credential in this workspace."
                          action={
                            <AppButton variant="secondary" size="sm" onClick={() => setParams({ type: undefined })}>
                              Clear filters
                            </AppButton>
                          }
                        />
                      ) : (
                        <AppEmptyState
                          icon={<KeyRound aria-hidden />}
                          title="Add your first credential"
                          description="Credentials let a workflow call an API that needs a token, without the token living in the workflow."
                          action={<AddCredentialButton size="sm" />}
                        />
                      )}
                    </AppTableMessageRow>
                  ) : (
                    query.data.items.map((credential) => (
                      <CredentialRow
                        key={credential.id}
                        credential={credential}
                        onEdit={editable ? dialog.edit : undefined}
                        onDelete={editable ? setPendingDelete : undefined}
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

      <CredentialDialog open={dialog.open} credential={dialog.editing} onClose={dialog.close} />

      <AppConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteMutation.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
        }}
        title={`Delete “${pendingDelete?.name ?? ""}”?`}
        description="The stored value is destroyed and cannot be recovered. Any workflow step using this credential will start failing until you point it at another one."
        confirmLabel="Delete credential"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
