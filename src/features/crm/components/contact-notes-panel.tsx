"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { StickyNote, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppFormField } from "@/components/forms/form-field";
import { AppAvatar } from "@/components/ui/app-avatar";
import { AppButton } from "@/components/ui/app-button";
import { AppCard, AppCardContent } from "@/components/ui/app-card";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppPagination, paginationSummary } from "@/components/ui/app-pagination";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppTextarea } from "@/components/ui/app-textarea";
import { parsePageParam } from "@/features/crm/filters";
import { useAddContactNoteMutation, useDeleteContactNoteMutation } from "@/features/crm/mutations";
import { useContactNotesQuery } from "@/features/crm/queries";
import { contactNoteFormSchema, type ContactNoteFormValues } from "@/features/crm/schemas";
import type { ContactNote } from "@/features/crm/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";
import { pageCount } from "@/types/pagination";

const PAGE_KEYS = ["page"] as const;

function AddNoteForm({ contactId }: { contactId: string }) {
  const mutation = useAddContactNoteMutation(contactId);
  const form = useForm<ContactNoteFormValues>({
    resolver: zodResolver(contactNoteFormSchema),
    defaultValues: { body: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values, {
      onSuccess: () => form.reset({ body: "" }),
      onError: (error) => {
        if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
      },
    });
  });

  return (
    <AppCard>
      <AppCardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <AppFormField
            label="Add a note"
            description="Notes are visible to everyone in this workspace and feed the AI summary."
            error={form.formState.errors.body?.message}
          >
            {(field) => (
              <AppTextarea
                {...field}
                {...form.register("body")}
                rows={3}
                placeholder="What did you learn about this contact?"
                disabled={mutation.isPending}
              />
            )}
          </AppFormField>
          <div className="flex justify-end">
            <AppButton type="submit" size="sm" loading={mutation.isPending}>
              Add note
            </AppButton>
          </div>
        </form>
      </AppCardContent>
    </AppCard>
  );
}

function NoteItem({ note, onDelete }: { note: ContactNote; onDelete?: (note: ContactNote) => void }) {
  const authorName = note.author?.name ?? "Removed member";
  return (
    <li className="flex gap-3 border-b border-border px-5 py-4 last:border-0">
      <AppAvatar name={authorName} src={note.author?.avatarUrl} size="sm" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium text-foreground">{authorName}</span>
          <span className="text-xs text-foreground-muted">
            <AppRelativeTime value={note.createdAt} />
          </span>
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground-secondary">{note.body}</p>
      </div>
      {onDelete ? (
        <AppButton variant="ghost" size="icon-sm" aria-label={`Delete note by ${authorName}`} onClick={() => onDelete(note)}>
          <Trash2 aria-hidden />
        </AppButton>
      ) : null}
    </li>
  );
}

export function ContactNotesPanel({ contactId }: { contactId: string }) {
  const { membership, user } = useWorkspace();
  const [params, setParams] = useSearchParamState(PAGE_KEYS);
  const page = parsePageParam({ ...params });
  const query = useContactNotesQuery(contactId, page);
  const deleteMutation = useDeleteContactNoteMutation(contactId);
  const [pendingDelete, setPendingDelete] = useState<ContactNote | null>(null);

  // Authors may remove their own notes, admins may remove any. The server
  // enforces the same rule; this only decides whether to draw the control.
  const canDelete = (note: ContactNote) => canManage(membership.role) || note.author?.id === user.id;

  return (
    <div className="flex flex-col gap-4">
      {canEdit(membership.role) ? <AddNoteForm contactId={contactId} /> : null}

      {query.isPending ? (
        <AppCard aria-busy="true">
          <AppCardContent className="flex flex-col gap-4">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex gap-3">
                <AppSkeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <AppSkeleton className="h-3 w-40" />
                  <AppSkeleton className="h-3 w-full max-w-md" />
                </div>
              </div>
            ))}
          </AppCardContent>
        </AppCard>
      ) : query.isError ? (
        <AppCard>
          <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />
        </AppCard>
      ) : (
        <>
          <AppCard padding="none" aria-busy={query.isFetching || undefined}>
            {query.data.items.length === 0 ? (
              <AppEmptyState
                size="sm"
                icon={<StickyNote aria-hidden />}
                title="No notes yet"
                description={
                  canEdit(membership.role)
                    ? "Write down what you learn so the rest of the team, and the AI summary, can use it."
                    : "Nobody has written a note about this contact."
                }
              />
            ) : (
              <ul>
                {query.data.items.map((note) => (
                  <NoteItem key={note.id} note={note} onDelete={canDelete(note) ? setPendingDelete : undefined} />
                ))}
              </ul>
            )}
          </AppCard>
          <AppPagination
            page={query.data.page}
            pageCount={pageCount(query.data.total, query.data.pageSize)}
            onPageChange={(next) => setParams({ page: next > 1 ? next : undefined }, { resetPage: false })}
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
        title="Delete this note?"
        description="The note is removed from the contact's history for everyone. This cannot be undone."
        confirmLabel="Delete note"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
