"use client";

import { BookOpen, Database } from "lucide-react";
import type { Route } from "next";
import { useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge, type BadgeTone } from "@/components/ui/app-badge";
import { AppButton, AppButtonLink } from "@/components/ui/app-button";
import { AppCard } from "@/components/ui/app-card";
import { AppCheckbox } from "@/components/ui/app-checkbox";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { useUpdateChatbotMutation } from "@/features/chatbots/mutations";
import { useChatbotKnowledgeQuery } from "@/features/chatbots/queries";
import type { ChatbotKnowledgeOption } from "@/features/chatbots/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

const KB_STATUS_TONE: Record<string, BadgeTone> = {
  ready: "success",
  processing: "info",
  empty: "neutral",
  error: "danger",
};

function KnowledgeSelector({ chatbotId, options }: { chatbotId: string; options: ChatbotKnowledgeOption[] }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const update = useUpdateChatbotMutation(chatbotId);
  const attachedIds = new Set(options.filter((o) => o.attached).map((o) => o.id));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(attachedIds));
  const dirty = selected.size !== attachedIds.size || [...selected].some((id) => !attachedIds.has(id));
  const knowledgeHref = `/w/${membership.workspace.slug}/knowledge/collections` as Route;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <AppCard>
          <ul className="divide-y divide-border">
            {options.map((option) => (
              <li key={option.id} className="flex items-center gap-4 px-5 py-4">
                <AppCheckbox
                  id={`kb-${option.id}`}
                  checked={selected.has(option.id)}
                  onChange={() => toggle(option.id)}
                  disabled={!editable}
                  label={option.name}
                  description={`${option.sourceCount} source${option.sourceCount === 1 ? "" : "s"}`}
                  className="flex-1"
                />
                <AppBadge tone={KB_STATUS_TONE[option.status] ?? "neutral"} dot size="sm">
                  {option.status}
                </AppBadge>
              </li>
            ))}
          </ul>
        </AppCard>
        {editable ? (
          <div className="flex items-center justify-end gap-2">
            <AppButton variant="secondary" onClick={() => setSelected(new Set(attachedIds))} disabled={!dirty || update.isPending}>
              Discard
            </AppButton>
            <AppButton loading={update.isPending} disabled={!dirty} onClick={() => update.mutate({ collectionIds: [...selected] })}>
              Save knowledge
            </AppButton>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <AppAlert tone="info" title="How retrieval works">
          On each message the most relevant chunks from attached collections are retrieved and passed to the model, which cites them as
          numbered sources in its reply.
        </AppAlert>
        <AppButtonLink href={knowledgeHref} variant="secondary" leadingIcon={<BookOpen aria-hidden />}>
          Manage collections
        </AppButtonLink>
      </div>
    </div>
  );
}

export function ChatbotKnowledgePanel({ chatbotId }: { chatbotId: string }) {
  const { membership } = useWorkspace();
  const query = useChatbotKnowledgeQuery(chatbotId);

  if (query.isPending) return <AppSkeleton className="h-64" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;

  if (query.data.length === 0) {
    return (
      <AppCard>
        <AppEmptyState
          icon={<Database aria-hidden />}
          title="No collections in this workspace"
          description="Create a collection, add documents or URLs, and attach it here so the chatbot can answer from your content with citations."
          action={
            <AppButtonLink
              href={`/w/${membership.workspace.slug}/knowledge/collections` as Route}
              variant="primary"
              size="sm"
            >
              Go to Knowledge
            </AppButtonLink>
          }
        />
      </AppCard>
    );
  }

  // Re-key on the attached set so saved changes reset the local selection.
  const attachedKey = query.data
    .filter((o) => o.attached)
    .map((o) => o.id)
    .sort()
    .join(",");
  return <KnowledgeSelector key={attachedKey} chatbotId={chatbotId} options={query.data} />;
}
