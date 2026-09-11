import type { CreateContactInput, CreateContactNoteInput, UpdateContactInput } from "@/features/crm/schemas";
import type {
  Contact,
  ContactConversation,
  ContactListFilters,
  ContactNote,
  ContactSummary,
  ContactTagCount,
  ContactTimelineEntry,
} from "@/features/crm/types";
import { apiFetch, buildQueryString } from "@/lib/api/http";
import type { Paginated, PaginationParams } from "@/types/pagination";

const base = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/crm`;
const contact = (workspaceSlug: string, contactId: string) => `${base(workspaceSlug)}/contacts/${contactId}`;

/** Client-side API surface for the CRM domain. */
export const crmApi = {
  listContacts: (workspaceSlug: string, filters: ContactListFilters = {}) =>
    apiFetch<Paginated<ContactSummary>>(`${base(workspaceSlug)}/contacts${buildQueryString(filters)}`),
  getContact: (workspaceSlug: string, contactId: string) => apiFetch<Contact>(contact(workspaceSlug, contactId)),
  createContact: (workspaceSlug: string, input: CreateContactInput) =>
    apiFetch<Contact>(`${base(workspaceSlug)}/contacts`, { method: "POST", json: input }),
  updateContact: (workspaceSlug: string, contactId: string, input: UpdateContactInput) =>
    apiFetch<Contact>(contact(workspaceSlug, contactId), { method: "PATCH", json: input }),
  deleteContact: (workspaceSlug: string, contactId: string) =>
    apiFetch<void>(contact(workspaceSlug, contactId), { method: "DELETE" }),

  tags: (workspaceSlug: string) => apiFetch<ContactTagCount[]>(`${base(workspaceSlug)}/tags`),

  listNotes: (workspaceSlug: string, contactId: string, params: PaginationParams = {}) =>
    apiFetch<Paginated<ContactNote>>(`${contact(workspaceSlug, contactId)}/notes${buildQueryString(params)}`),
  createNote: (workspaceSlug: string, contactId: string, input: CreateContactNoteInput) =>
    apiFetch<ContactNote>(`${contact(workspaceSlug, contactId)}/notes`, { method: "POST", json: input }),
  deleteNote: (workspaceSlug: string, contactId: string, noteId: string) =>
    apiFetch<void>(`${contact(workspaceSlug, contactId)}/notes/${noteId}`, { method: "DELETE" }),

  listActivities: (workspaceSlug: string, contactId: string, params: PaginationParams = {}) =>
    apiFetch<Paginated<ContactTimelineEntry>>(`${contact(workspaceSlug, contactId)}/activities${buildQueryString(params)}`),
  listConversations: (workspaceSlug: string, contactId: string, params: PaginationParams = {}) =>
    apiFetch<Paginated<ContactConversation>>(`${contact(workspaceSlug, contactId)}/conversations${buildQueryString(params)}`),

  generateSummary: (workspaceSlug: string, contactId: string) =>
    apiFetch<Contact>(`${contact(workspaceSlug, contactId)}/summary`, { method: "POST" }),
};
