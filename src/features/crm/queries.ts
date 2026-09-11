import { queryOptions, useQuery } from "@tanstack/react-query";

import { crmApi } from "@/features/crm/api";
import type { ContactListFilters } from "@/features/crm/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import type { PaginationParams } from "@/types/pagination";

/**
 * The detail tabs (notes, activity, conversations) live under the contact's
 * detail key on purpose: a mutation that changes the contact invalidates the
 * whole subtree in one call, and counts on the detail record stay consistent
 * with the lists they summarize.
 */
export const crmKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "crm"] as const,
  contacts: (workspaceSlug: string) => [...crmKeys.all(workspaceSlug), "contacts"] as const,
  lists: (workspaceSlug: string) => [...crmKeys.contacts(workspaceSlug), "list"] as const,
  list: (workspaceSlug: string, filters: ContactListFilters) => [...crmKeys.lists(workspaceSlug), filters] as const,
  detail: (workspaceSlug: string, contactId: string) => [...crmKeys.contacts(workspaceSlug), "detail", contactId] as const,
  notesAll: (workspaceSlug: string, contactId: string) => [...crmKeys.detail(workspaceSlug, contactId), "notes"] as const,
  notes: (workspaceSlug: string, contactId: string, page: number) =>
    [...crmKeys.notesAll(workspaceSlug, contactId), page] as const,
  activitiesAll: (workspaceSlug: string, contactId: string) =>
    [...crmKeys.detail(workspaceSlug, contactId), "activities"] as const,
  activities: (workspaceSlug: string, contactId: string, page: number) =>
    [...crmKeys.activitiesAll(workspaceSlug, contactId), page] as const,
  conversationsAll: (workspaceSlug: string, contactId: string) =>
    [...crmKeys.detail(workspaceSlug, contactId), "conversations"] as const,
  conversations: (workspaceSlug: string, contactId: string, page: number) =>
    [...crmKeys.conversationsAll(workspaceSlug, contactId), page] as const,
  tags: (workspaceSlug: string) => [...crmKeys.all(workspaceSlug), "tags"] as const,
};

/** Shared query definitions so server prefetch and client hooks agree on keys. */
export const crmQueries = {
  list: (workspaceSlug: string, filters: ContactListFilters) =>
    queryOptions({
      queryKey: crmKeys.list(workspaceSlug, filters),
      queryFn: () => crmApi.listContacts(workspaceSlug, filters),
    }),
  detail: (workspaceSlug: string, contactId: string) =>
    queryOptions({
      queryKey: crmKeys.detail(workspaceSlug, contactId),
      queryFn: () => crmApi.getContact(workspaceSlug, contactId),
    }),
  tags: (workspaceSlug: string) =>
    queryOptions({
      queryKey: crmKeys.tags(workspaceSlug),
      queryFn: () => crmApi.tags(workspaceSlug),
    }),
  notes: (workspaceSlug: string, contactId: string, params: PaginationParams = {}) =>
    queryOptions({
      queryKey: crmKeys.notes(workspaceSlug, contactId, params.page ?? 1),
      queryFn: () => crmApi.listNotes(workspaceSlug, contactId, params),
    }),
  activities: (workspaceSlug: string, contactId: string, params: PaginationParams = {}) =>
    queryOptions({
      queryKey: crmKeys.activities(workspaceSlug, contactId, params.page ?? 1),
      queryFn: () => crmApi.listActivities(workspaceSlug, contactId, params),
    }),
  conversations: (workspaceSlug: string, contactId: string, params: PaginationParams = {}) =>
    queryOptions({
      queryKey: crmKeys.conversations(workspaceSlug, contactId, params.page ?? 1),
      queryFn: () => crmApi.listConversations(workspaceSlug, contactId, params),
    }),
};

export function useContactsQuery(filters: ContactListFilters) {
  const { membership } = useWorkspace();
  return useQuery({ ...crmQueries.list(membership.workspace.slug, filters), placeholderData: (previous) => previous });
}

export function useContactQuery(contactId: string) {
  const { membership } = useWorkspace();
  return useQuery(crmQueries.detail(membership.workspace.slug, contactId));
}

export function useContactTagsQuery() {
  const { membership } = useWorkspace();
  return useQuery(crmQueries.tags(membership.workspace.slug));
}

export function useContactNotesQuery(contactId: string, page: number) {
  const { membership } = useWorkspace();
  return useQuery({
    ...crmQueries.notes(membership.workspace.slug, contactId, { page }),
    placeholderData: (previous) => previous,
  });
}

export function useContactActivitiesQuery(contactId: string, page: number) {
  const { membership } = useWorkspace();
  return useQuery({
    ...crmQueries.activities(membership.workspace.slug, contactId, { page }),
    placeholderData: (previous) => previous,
  });
}

export function useContactConversationsQuery(contactId: string, page: number) {
  const { membership } = useWorkspace();
  return useQuery({
    ...crmQueries.conversations(membership.workspace.slug, contactId, { page }),
    placeholderData: (previous) => previous,
  });
}
