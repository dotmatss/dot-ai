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
import { useUpdateAgentMutation } from "@/features/agents/mutations";
import { useAgentKnowledgeQuery } from "@/features/agents/queries";
import type { AgentKnowledgeOption } from "@/features/agents/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

const KB_STATUS_TONE: Record<string, BadgeTone> = {
  ready: "success",
  processing: "info",
  empty: "neutral",
  error: "danger",
};

function KnowledgeSelector({ agentId, options }: { agentId: string; options: AgentKnowledgeOption[] }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const update = useUpdateAgentMutation(agentId);
  const attachedIds = new Set(options.filter((option) => option.attached).map((option) => option.id));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(attachedIds));
  const dirty = selected.size !== attachedIds.size || [...selected].some((id) => !attachedIds.has(id));
  const knowledgeHref = `/w/${membership.workspace.slug}/knowledge` as Route;

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
            <AppButton loading={update.isPending} disabled={!dirty} onClick={() => update.mutate({ knowledgeBaseIds: [...selected] })}>
              Save knowledge
            </AppButton>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <AppAlert tone="info" title="How retrieval works">
          On every run the most relevant chunks from the attached knowledge bases are retrieved for the incoming task and passed to the model, which
          cites them as numbered sources. Enable the knowledge search tool as well if the agent should look things up mid-task.
        </AppAlert>
        <AppButtonLink href={knowledgeHref} variant="secondary" leadingIcon={<BookOpen aria-hidden />}>
          Manage knowledge bases
        </AppButtonLink>
      </div>
    </div>
  );
}

export function AgentKnowledgePanel({ agentId }: { agentId: string }) {
  const { membership } = useWorkspace();
  const query = useAgentKnowledgeQuery(agentId);

  if (query.isPending) return <AppSkeleton className="h-64" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;

  if (query.data.length === 0) {
    return (
      <AppCard>
        <AppEmptyState
          icon={<Database aria-hidden />}
          title="No knowledge bases in this workspace"
          description="Create a knowledge base, add documents or URLs, and attach it here so the agent can work from your content and cite it."
          action={
            <AppButtonLink href={`/w/${membership.workspace.slug}/knowledge` as Route} variant="primary" size="sm">
              Go to Knowledge
            </AppButtonLink>
          }
        />
      </AppCard>
    );
  }

  // Re-key on the attached set so saved changes reset the local selection.
  const attachedKey = query.data
    .filter((option) => option.attached)
    .map((option) => option.id)
    .sort()
    .join(",");
  return <KnowledgeSelector key={attachedKey} agentId={agentId} options={query.data} />;
}
