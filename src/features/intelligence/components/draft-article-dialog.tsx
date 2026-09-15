"use client";

import { FileText } from "lucide-react";
import { useState } from "react";

import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppLabel } from "@/components/ui/app-label";
import { AppSelect } from "@/components/ui/app-select";
import { useDraftArticleMutation } from "@/features/intelligence/mutations";
import type { Topic } from "@/features/intelligence/types";
import { useCollectionOptionsQuery } from "@/features/knowledge/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

const UNORGANIZED = "";

/**
 * Drafts a knowledge article from a topic.
 *
 * The dialog is explicit about what the model is and is not doing, because the
 * failure mode it guards against is somebody assuming the draft contains
 * answers and filing it into a live collection unread. The default destination
 * is Unorganized, which no agent can retrieve from.
 */
function DraftArticleDialog({ topic, open, onClose }: { topic: Topic; open: boolean; onClose: () => void }) {
  const [collectionId, setCollectionId] = useState<string>(UNORGANIZED);
  const collections = useCollectionOptionsQuery();
  const mutation = useDraftArticleMutation(topic.id);

  function submit() {
    mutation.mutate(
      { collectionId: collectionId === UNORGANIZED ? null : collectionId },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      dismissible={!mutation.isPending}
      title="Draft a knowledge article"
      description={`From the questions people asked about “${topic.label}”.`}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </AppButton>
          <AppButton onClick={submit} loading={mutation.isPending}>
            <FileText aria-hidden />
            Draft article
          </AppButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <AppAlert tone="info" title="The draft has no answers in it">
          The model is given the questions and not the answers, and is instructed never to invent one. You get the
          structure — the questions, deduplicated and grouped, each marked <strong>ANSWER NEEDED</strong> — for somebody
          who knows the answers to fill in.
        </AppAlert>

        <div className="flex flex-col gap-1.5">
          <AppLabel htmlFor="draft-collection">File it in</AppLabel>
          <AppSelect
            id="draft-collection"
            value={collectionId}
            onChange={(event) => setCollectionId(event.target.value)}
            disabled={collections.isPending || mutation.isPending}
            options={[
              { value: UNORGANIZED, label: "Unorganized (recommended)" },
              ...(collections.data ?? []).map((collection) => ({ value: collection.id, label: collection.name })),
            ]}
          />
          <p className="text-xs text-foreground-muted">
            {collectionId === UNORGANIZED
              ? "Unorganized sources are indexed but no agent can retrieve them, so an unfinished draft cannot be cited to a customer."
              : "Sources in a collection are retrievable by every agent using it. Only pick one if somebody is going to finish the draft first."}
          </p>
        </div>
      </div>
    </AppDialog>
  );
}

/**
 * Trigger paired with the dialog, so a caller mounts one component.
 *
 * The dialog itself is not exported: it is only ever opened from this button,
 * and an exported half would invite a second trigger with its own role check.
 */
export function DraftArticleButton({ topic }: { topic: Topic }) {
  const { membership } = useWorkspace();
  const [open, setOpen] = useState(false);
  if (!canEdit(membership.role)) return null;

  return (
    <>
      <AppButton variant="secondary" onClick={() => setOpen(true)}>
        <FileText aria-hidden />
        Draft article
      </AppButton>
      <DraftArticleDialog topic={topic} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
