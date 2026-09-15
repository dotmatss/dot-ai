"use client";

import { ScrollText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppInput, AppSearchInput } from "@/components/ui/app-input";
import { AppPagination, paginationSummary } from "@/components/ui/app-pagination";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSelect } from "@/components/ui/app-select";
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
import { AppText } from "@/components/ui/app-typography";
import { actionLabel, entityTypeLabel } from "@/features/audit/constants";
import { AUDIT_FILTER_KEYS, hasAuditFilters, parseAuditFilters } from "@/features/audit/filters";
import { useAuditFacetsQuery, useAuditListQuery } from "@/features/audit/queries";
import type { AuditEntry } from "@/features/audit/types";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { pageCount } from "@/types/pagination";

const COLUMNS = 4;

function AuditRow({ entry }: { entry: AuditEntry }) {
  return (
    <AppTableRow>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        {/* Never formatRelativeTime here: this is a Client Component, and a
            relative time computed during render is the documented hydration
            mismatch. AppRelativeTime renders the absolute date until hydrated. */}
        <AppRelativeTime value={entry.createdAt} />
      </AppTableCell>
      <AppTableCell className="max-w-40 truncate">
        {/* An actor is null once their account is deleted: activity_log.actor_id
            is ON DELETE SET NULL and no name is snapshotted. */}
        {entry.actorName ?? <span className="text-foreground-subtle">System</span>}
      </AppTableCell>
      <AppTableCell>
        <span className="flex flex-wrap items-center gap-1.5">
          <AppBadge size="sm" tone="neutral" variant="soft">
            {entityTypeLabel(entry.entityType)}
          </AppBadge>
          <span className="text-xs text-foreground-muted">{actionLabel(entry.action)}</span>
        </span>
      </AppTableCell>
      <AppTableCell className="text-foreground">{entry.summary}</AppTableCell>
    </AppTableRow>
  );
}

export function AuditLogTable() {
  const [params, setParams] = useSearchParamState(AUDIT_FILTER_KEYS);
  const [search, setSearch] = useState(params.q ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    const current = params.q ?? "";
    if (debouncedSearch !== current) setParams({ q: debouncedSearch || undefined });
  }, [debouncedSearch, params.q, setParams]);

  const filters = useMemo(
    () => parseAuditFilters({ ...params, q: debouncedSearch || undefined }),
    [params, debouncedSearch],
  );

  const query = useAuditListQuery(filters);
  const facets = useAuditFacetsQuery();
  const active = hasAuditFilters(filters);

  function clearFilters() {
    setSearch("");
    setParams({ q: undefined, actorId: undefined, entityType: undefined, action: undefined, from: undefined, to: undefined });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="w-full sm:max-w-xs">
          <AppSearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search the log…"
            aria-label="Search the audit log"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <AppSelect
              size="sm"
              aria-label="Filter by person"
              value={filters.actorId ?? ""}
              onChange={(event) => setParams({ actorId: event.target.value || undefined })}
              options={[
                { value: "", label: "Anyone" },
                ...(facets.data?.actors ?? []).map((actor) => ({ value: actor.id, label: actor.name })),
              ]}
            />
          </div>
          <div className="w-40">
            <AppSelect
              size="sm"
              aria-label="Filter by type"
              value={filters.entityType ?? ""}
              onChange={(event) => setParams({ entityType: event.target.value || undefined })}
              options={[
                { value: "", label: "Anything" },
                ...(facets.data?.entityTypes ?? []).map((value) => ({ value, label: entityTypeLabel(value) })),
              ]}
            />
          </div>
          <div className="w-40">
            <AppSelect
              size="sm"
              aria-label="Filter by action"
              value={filters.action ?? ""}
              onChange={(event) => setParams({ action: event.target.value || undefined })}
              options={[
                { value: "", label: "Any action" },
                ...(facets.data?.actions ?? []).map((value) => ({ value, label: actionLabel(value) })),
              ]}
            />
          </div>
          <AppInput
            type="date"
            size="sm"
            className="w-40"
            aria-label="From date"
            value={filters.from ?? ""}
            onChange={(event) => setParams({ from: event.target.value || undefined })}
          />
          <AppInput
            type="date"
            size="sm"
            className="w-40"
            aria-label="To date"
            value={filters.to ?? ""}
            onChange={(event) => setParams({ to: event.target.value || undefined })}
          />
          {active ? (
            <AppButton variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </AppButton>
          ) : null}
        </div>
      </div>

      {query.isPending ? (
        <AppListSkeleton rows={8} />
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
                  <AppTableHead>When</AppTableHead>
                  <AppTableHead>Who</AppTableHead>
                  <AppTableHead>What</AppTableHead>
                  <AppTableHead>Summary</AppTableHead>
                </AppTableRow>
              </AppTableHeader>
              <AppTableBody>
                {query.data.items.length === 0 ? (
                  <AppTableMessageRow colSpan={COLUMNS}>
                    {active ? (
                      <AppEmptyState
                        size="sm"
                        title="Nothing matches these filters"
                        description="Try a wider date range, or clear the filters to see the whole log."
                        action={
                          <AppButton variant="secondary" size="sm" onClick={clearFilters}>
                            Clear filters
                          </AppButton>
                        }
                      />
                    ) : (
                      <AppEmptyState
                        icon={<ScrollText aria-hidden />}
                        title="Nothing recorded yet"
                        description="Entries appear here as people create, change and approve things in this workspace."
                      />
                    )}
                  </AppTableMessageRow>
                ) : (
                  query.data.items.map((entry) => <AuditRow key={entry.id} entry={entry} />)
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
          <AppText size="sm" tone="muted">
            The log is append-only and records what the application did. It keeps no copy of a deleted person&apos;s name,
            so their past entries show as “System”.
          </AppText>
        </>
      )}
    </div>
  );
}
