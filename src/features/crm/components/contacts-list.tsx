"use client";

import { MoreHorizontal, Trash2, UserRound, Users } from "lucide-react";
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
import { AppTooltip } from "@/components/ui/app-tooltip";
import { ContactAvatar } from "@/features/crm/components/contact-avatar";
import { ContactStageBadge } from "@/features/crm/components/contact-stage-badge";
import { ContactTagFilter } from "@/features/crm/components/contact-tag-filter";
import { CreateContactButton } from "@/features/crm/components/create-contact-dialog";
import { CONTACT_STAGE_META, CONTACT_STAGE_ORDER } from "@/features/crm/constants";
import { CONTACT_FILTER_KEYS, hasActiveContactFilters, parseContactFilters } from "@/features/crm/filters";
import { useDeleteContactMutation } from "@/features/crm/mutations";
import { contactDisplayName } from "@/features/crm/normalize";
import { useContactsQuery } from "@/features/crm/queries";
import type { ContactSummary } from "@/features/crm/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { pageCount } from "@/types/pagination";

const COLUMNS = 7;
const VISIBLE_TAGS = 2;

function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return (
      <span className="text-foreground-subtle" aria-label="No tags">
        —
      </span>
    );
  }
  const visible = tags.slice(0, VISIBLE_TAGS);
  const overflow = tags.slice(VISIBLE_TAGS);
  return (
    <span className="flex items-center gap-1">
      {visible.map((tag) => (
        <AppBadge key={tag} size="sm">
          {tag}
        </AppBadge>
      ))}
      {overflow.length > 0 ? (
        <AppTooltip content={overflow.join(", ")}>
          {/* Focusable so the overflow is reachable without a pointer; the
              aria-label carries the same list for screen readers. */}
          <span tabIndex={0} className="rounded-full focus-ring" aria-label={`${overflow.length} more tags: ${overflow.join(", ")}`}>
            <AppBadge size="sm" variant="outline">
              +{overflow.length}
            </AppBadge>
          </span>
        </AppTooltip>
      ) : null}
    </span>
  );
}

function ContactRow({ contact, onDelete }: { contact: ContactSummary; onDelete?: (contact: ContactSummary) => void }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const href = `/w/${membership.workspace.slug}/crm/${contact.id}` as Route;
  const displayName = contactDisplayName(contact);

  return (
    <AppTableRow>
      <AppTableCell>
        <Link href={href} className="group flex items-center gap-3 rounded-md focus-ring">
          <ContactAvatar contact={contact} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground group-hover:underline group-hover:underline-offset-4">
              {displayName}
            </span>
            {contact.email && contact.name ? (
              <span className="block max-w-64 truncate text-xs text-foreground-muted">{contact.email}</span>
            ) : null}
          </span>
        </Link>
      </AppTableCell>
      <AppTableCell className="text-foreground-secondary">
        {contact.company ?? <span className="text-foreground-subtle">—</span>}
      </AppTableCell>
      <AppTableCell>
        <ContactStageBadge stage={contact.stage} size="sm" />
      </AppTableCell>
      <AppTableCell>
        <TagList tags={contact.tags} />
      </AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        {contact.lastSeenAt ? <AppRelativeTime value={contact.lastSeenAt} /> : <span className="text-foreground-subtle">Never</span>}
      </AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        <AppRelativeTime value={contact.createdAt} />
      </AppTableCell>
      <AppTableCell className="w-12 text-right">
        <AppDropdownMenu
          label={`Actions for ${displayName}`}
          trigger={
            <AppButton variant="ghost" size="icon-sm" aria-label={`Actions for ${displayName}`}>
              <MoreHorizontal aria-hidden />
            </AppButton>
          }
        >
          <AppDropdownMenuItem icon={<UserRound aria-hidden />} onSelect={() => router.push(href)}>
            Open contact
          </AppDropdownMenuItem>
          {onDelete ? (
            <AppDropdownMenuItem destructive icon={<Trash2 aria-hidden />} onSelect={() => onDelete(contact)}>
              Delete
            </AppDropdownMenuItem>
          ) : null}
        </AppDropdownMenu>
      </AppTableCell>
    </AppTableRow>
  );
}

export function ContactsList() {
  const { membership } = useWorkspace();
  const [params, setParams] = useSearchParamState(CONTACT_FILTER_KEYS);
  const [search, setSearch] = useState(params.q ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [pendingDelete, setPendingDelete] = useState<ContactSummary | null>(null);
  const deleteMutation = useDeleteContactMutation();

  // Persist the debounced search term in the URL so it survives reloads.
  useEffect(() => {
    const current = params.q ?? "";
    if (debouncedSearch !== current) setParams({ q: debouncedSearch || undefined });
  }, [debouncedSearch, params.q, setParams]);

  const filters = useMemo(() => parseContactFilters({ ...params, q: debouncedSearch || undefined }), [params, debouncedSearch]);
  const query = useContactsQuery(filters);
  const filtered = hasActiveContactFilters(filters);

  function clearFilters() {
    setSearch("");
    setParams({ q: undefined, stage: undefined, tag: undefined });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full lg:max-w-xs">
          <AppSearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search name, email or company…"
            aria-label="Search contacts"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by stage">
            <AppChip selected={!filters.stage} onClick={() => setParams({ stage: undefined })}>
              All
            </AppChip>
            {CONTACT_STAGE_ORDER.map((stage) => (
              <AppChip
                key={stage}
                selected={filters.stage === stage}
                onClick={() => setParams({ stage: filters.stage === stage ? undefined : stage })}
              >
                {CONTACT_STAGE_META[stage].label}
              </AppChip>
            ))}
          </div>
          <ContactTagFilter selected={filters.tag} onSelect={(tag) => setParams({ tag })} />
        </div>
      </div>

      {query.isPending ? (
        <AppListSkeleton rows={6} />
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
                  <AppTableHead>Contact</AppTableHead>
                  <AppTableHead>Company</AppTableHead>
                  <AppTableHead>Stage</AppTableHead>
                  <AppTableHead>Tags</AppTableHead>
                  <AppTableHead>Last seen</AppTableHead>
                  <AppTableHead>Created</AppTableHead>
                  <AppTableHead>
                    <span className="sr-only">Actions</span>
                  </AppTableHead>
                </AppTableRow>
              </AppTableHeader>
              <AppTableBody>
                {query.data.items.length === 0 ? (
                  <AppTableMessageRow colSpan={COLUMNS}>
                    {filtered ? (
                      <AppEmptyState
                        size="sm"
                        title="No contacts match your filters"
                        description="Try a different search term, stage or tag."
                        action={
                          <AppButton variant="secondary" size="sm" onClick={clearFilters}>
                            Clear filters
                          </AppButton>
                        }
                      />
                    ) : (
                      <AppEmptyState
                        icon={<Users aria-hidden />}
                        title="No contacts yet"
                        description="Add the people you talk to. Chatbots, agents and workflows can capture leads here automatically once they are live."
                        action={<CreateContactButton />}
                      />
                    )}
                  </AppTableMessageRow>
                ) : (
                  query.data.items.map((contact) => (
                    <ContactRow
                      key={contact.id}
                      contact={contact}
                      onDelete={canManage(membership.role) ? setPendingDelete : undefined}
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

      <AppConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteMutation.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
        }}
        title={`Delete “${pendingDelete ? contactDisplayName(pendingDelete) : ""}”?`}
        description="Notes, activity history and custom properties are deleted with the contact. Linked conversations are kept but lose the contact. This cannot be undone."
        confirmLabel="Delete contact"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
