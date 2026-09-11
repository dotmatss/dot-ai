import { useMutation, useQueryClient } from "@tanstack/react-query";

import { crmApi } from "@/features/crm/api";
import { crmKeys } from "@/features/crm/queries";
import type { CreateContactInput, CreateContactNoteInput, UpdateContactInput } from "@/features/crm/schemas";
import type { Contact } from "@/features/crm/types";
import { contactDisplayName } from "@/features/crm/normalize";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { isApiError } from "@/lib/api/api-error";
import { toast } from "@/stores/toast-store";

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

export function useCreateContactMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: CreateContactInput) => crmApi.createContact(slug, input),
    onSuccess: (contact) => {
      queryClient.setQueryData(crmKeys.detail(slug, contact.id), contact);
      void queryClient.invalidateQueries({ queryKey: crmKeys.lists(slug) });
      void queryClient.invalidateQueries({ queryKey: crmKeys.tags(slug) });
      toast.success({ title: "Contact created", description: `${contactDisplayName(contact)} was added to your CRM.` });
    },
    onError: (error) => toast.error({ title: "Could not create contact", description: errorMessage(error, "Please try again.") }),
  });
}

export function useUpdateContactMutation(contactId: string, options: { silent?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  const detailKey = crmKeys.detail(slug, contactId);

  return useMutation({
    mutationFn: (input: UpdateContactInput) => crmApi.updateContact(slug, contactId, input),
    onMutate: async (input) => {
      // Optimistic only for the stage control, which is a single click and
      // should feel instant. exact: true - the notes, activity and
      // conversation queries live under this key prefix and would otherwise be
      // cancelled and left pending forever.
      await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
      const previous = queryClient.getQueryData<Contact>(detailKey);
      if (previous && input.stage) {
        queryClient.setQueryData<Contact>(detailKey, { ...previous, stage: input.stage });
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(detailKey, context.previous);
      toast.error({ title: "Could not save changes", description: errorMessage(error, "Please try again.") });
    },
    onSuccess: (contact) => {
      queryClient.setQueryData(detailKey, contact);
      void queryClient.invalidateQueries({ queryKey: crmKeys.lists(slug) });
      void queryClient.invalidateQueries({ queryKey: crmKeys.tags(slug) });
      // Stage, tag and property edits each append to the contact's timeline.
      void queryClient.invalidateQueries({ queryKey: crmKeys.activitiesAll(slug, contactId) });
      if (!options.silent) toast.success("Changes saved");
    },
  });
}

export function useDeleteContactMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (contactId: string) => crmApi.deleteContact(slug, contactId),
    onSuccess: (_result, contactId) => {
      queryClient.removeQueries({ queryKey: crmKeys.detail(slug, contactId) });
      void queryClient.invalidateQueries({ queryKey: crmKeys.lists(slug) });
      void queryClient.invalidateQueries({ queryKey: crmKeys.tags(slug) });
      toast.success("Contact deleted");
    },
    onError: (error) => toast.error({ title: "Could not delete contact", description: errorMessage(error, "Please try again.") }),
  });
}

export function useAddContactNoteMutation(contactId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: CreateContactNoteInput) => crmApi.createNote(slug, contactId, input),
    onSuccess: () => {
      // The note count lives on the contact and the note itself belongs in the
      // timeline, so the whole detail subtree is refreshed.
      void queryClient.invalidateQueries({ queryKey: crmKeys.detail(slug, contactId) });
      toast.success("Note added");
    },
    onError: (error) => toast.error({ title: "Could not add note", description: errorMessage(error, "Please try again.") }),
  });
}

export function useDeleteContactNoteMutation(contactId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (noteId: string) => crmApi.deleteNote(slug, contactId, noteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: crmKeys.detail(slug, contactId) });
      toast.success("Note deleted");
    },
    onError: (error) => toast.error({ title: "Could not delete note", description: errorMessage(error, "Please try again.") }),
  });
}

export function useGenerateContactSummaryMutation(contactId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: () => crmApi.generateSummary(slug, contactId),
    onSuccess: (contact) => {
      queryClient.setQueryData(crmKeys.detail(slug, contactId), contact);
      void queryClient.invalidateQueries({ queryKey: crmKeys.activitiesAll(slug, contactId) });
      toast.success("Summary generated");
    },
    onError: (error) =>
      toast.error({ title: "Could not generate summary", description: errorMessage(error, "Please try again in a moment.") }),
  });
}
