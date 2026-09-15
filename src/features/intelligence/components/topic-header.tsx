"use client";

import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppInput } from "@/components/ui/app-input";
import { DraftArticleButton } from "@/features/intelligence/components/draft-article-dialog";
import { MAX_TOPIC_LABEL_CHARS } from "@/features/intelligence/constants";
import { isKnowledgeGap } from "@/features/intelligence/metrics";
import { useUpdateTopicMutation } from "@/features/intelligence/mutations";
import type { Topic } from "@/features/intelligence/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

/**
 * Topic title, with inline rename.
 *
 * A model-written label is a guess, and the person reading it usually knows
 * better. Renaming is a one-field edit, so it is an inline control rather than
 * a dialog - and `updateTopic` deliberately leaves `labeled_at` alone so the
 * next analysis does not overwrite the name a human chose.
 */
export function TopicHeader({ topic }: { topic: Topic }) {
  const { membership } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(topic.label);
  const mutation = useUpdateTopicMutation(topic.id);
  const allowed = canEdit(membership.role);

  // The draft is seeded when the field opens rather than reconciled by an
  // effect. There is nothing to reconcile: while the field is closed its value
  // is never read, and while it is open the value belongs to whoever is typing
  // - so a run relabelling the topic underneath must not reach into it.
  function startEditing() {
    setLabel(topic.label);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setLabel(topic.label);
  }

  function save() {
    const next = label.trim();
    if (!next || next === topic.label) {
      cancel();
      return;
    }
    mutation.mutate({ label: next }, { onSuccess: () => setEditing(false) });
  }

  return (
    <PageHeader
      title={
        editing ? (
          <span className="flex items-center gap-2">
            <AppInput
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={MAX_TOPIC_LABEL_CHARS}
              aria-label="Topic name"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") save();
                if (event.key === "Escape") cancel();
              }}
              className="max-w-sm"
            />
            <AppButton size="icon-sm" onClick={save} loading={mutation.isPending} aria-label="Save topic name">
              <Check aria-hidden />
            </AppButton>
            <AppButton
              size="icon-sm"
              variant="ghost"
              onClick={cancel}
              aria-label="Cancel rename"
            >
              <X aria-hidden />
            </AppButton>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span>{topic.label}</span>
            {isKnowledgeGap(topic) ? (
              <AppBadge tone="danger" size="sm">
                Knowledge gap
              </AppBadge>
            ) : null}
            {allowed ? (
              <AppButton size="icon-sm" variant="ghost" onClick={startEditing} aria-label="Rename topic">
                <Pencil aria-hidden />
              </AppButton>
            ) : null}
          </span>
        )
      }
      description={topic.summary ?? "No summary yet. The next analysis will write one."}
      actions={<DraftArticleButton topic={topic} />}
    />
  );
}
