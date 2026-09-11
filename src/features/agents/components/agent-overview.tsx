"use client";

import { ArrowUpRight, BookOpen, Check, Circle, MessagesSquare, Play, Sparkles, Wrench } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButtonLink } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardDescription, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppStat } from "@/components/ui/app-stat";
import { useAgentOverviewQuery, useAgentQuery } from "@/features/agents/queries";
import { AGENT_TOOLS } from "@/features/agents/tools/registry";
import type { Agent } from "@/features/agents/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { cn } from "@/lib/cn";

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function SetupChecklist({ agent, base }: { agent: Agent; base: string }) {
  const steps = [
    { done: agent.instructions.trim().length > 0, label: "Write instructions", href: `${base}/instructions`, icon: Sparkles },
    { done: agent.enabledToolCount > 0, label: "Enable at least one tool", href: `${base}/tools`, icon: Wrench },
    { done: agent.collectionIds.length > 0, label: "Attach a collection", href: `${base}/knowledge`, icon: BookOpen },
    { done: agent.status === "active", label: "Activate the agent", href: `${base}/settings`, icon: Play },
  ];
  const completed = steps.filter((step) => step.done).length;
  return (
    <AppCard>
      <AppCardHeader>
        <div>
          <AppCardTitle>Setup</AppCardTitle>
          <AppCardDescription>
            {completed === steps.length ? "Everything is configured." : `${completed} of ${steps.length} steps complete.`}
          </AppCardDescription>
        </div>
      </AppCardHeader>
      <AppCardContent className="pt-4">
        <ol className="flex flex-col gap-1">
          {steps.map((step) => (
            <li key={step.label}>
              <Link
                href={step.href as Route}
                className="flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-surface-muted focus-ring"
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    step.done ? "border-accent bg-accent text-accent-foreground" : "border-border-strong text-transparent",
                  )}
                  aria-hidden
                >
                  {step.done ? <Check className="size-3" strokeWidth={3} /> : <Circle className="size-3" />}
                </span>
                <span className={cn("flex-1", step.done && "text-foreground-muted line-through decoration-foreground-subtle")}>{step.label}</span>
                <span className="sr-only">{step.done ? "(done)" : "(to do)"}</span>
                <ArrowUpRight aria-hidden className="size-4 text-foreground-subtle" />
              </Link>
            </li>
          ))}
        </ol>
      </AppCardContent>
    </AppCard>
  );
}

export function AgentOverview({ agentId }: { agentId: string }) {
  const { membership } = useWorkspace();
  const agentQuery = useAgentQuery(agentId);
  const overviewQuery = useAgentOverviewQuery(agentId);
  const base = `/w/${membership.workspace.slug}/agents/${agentId}`;
  const inboxHref = `/w/${membership.workspace.slug}/conversations?agentId=${agentId}` as Route;

  if (agentQuery.isPending) {
    return <AppSkeleton className="h-64" />;
  }
  if (agentQuery.isError) {
    return <AppErrorState error={agentQuery.error} onRetry={() => void agentQuery.refetch()} />;
  }
  const agent = agentQuery.data;
  const overview = overviewQuery.data;
  const enabledTools = agent.tools.filter((tool) => tool.enabled);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <div className="grid gap-4 sm:grid-cols-2">
          {overviewQuery.isPending ? (
            <>
              <AppSkeleton className="h-32" />
              <AppSkeleton className="h-32" />
            </>
          ) : overviewQuery.isError ? (
            <AppCard className="sm:col-span-2">
              <AppErrorState size="sm" error={overviewQuery.error} onRetry={() => void overviewQuery.refetch()} />
            </AppCard>
          ) : overview ? (
            <>
              <AppStat
                label="Conversations · last 7 days"
                value={overview.conversationsLast7Days}
                delta={percentChange(overview.conversationsLast7Days, overview.conversationsPrevious7Days)}
                deltaLabel="vs previous 7 days"
              />
              <AppStat
                label="Messages · last 7 days"
                value={overview.messagesLast7Days}
                delta={percentChange(overview.messagesLast7Days, overview.messagesPrevious7Days)}
                deltaLabel="vs previous 7 days"
              />
            </>
          ) : null}
        </div>

        <AppCard>
          <AppCardHeader>
            <div>
              <AppCardTitle>Recent conversations</AppCardTitle>
              <AppCardDescription>The latest runs of this agent, including playground tests.</AppCardDescription>
            </div>
            <AppButtonLink href={inboxHref} variant="ghost" size="sm" trailingIcon={<ArrowUpRight aria-hidden />}>
              View all
            </AppButtonLink>
          </AppCardHeader>
          <AppCardContent className="pt-4">
            {overviewQuery.isPending ? (
              <AppSkeleton className="h-40" />
            ) : !overview || overview.recentConversations.length === 0 ? (
              <AppEmptyState
                size="sm"
                icon={<MessagesSquare aria-hidden />}
                title="No conversations yet"
                description="Run the agent in the playground to see how it reasons, which tools it reaches for and what it produces."
                action={
                  <AppButtonLink href={`${base}/playground` as Route} size="sm" variant="secondary">
                    Open playground
                  </AppButtonLink>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {overview.recentConversations.map((conversation) => (
                  <li key={conversation.id}>
                    <Link
                      href={`/w/${membership.workspace.slug}/conversations/${conversation.id}` as Route}
                      className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 text-sm hover:bg-surface-hover focus-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{conversation.title ?? "Untitled conversation"}</span>
                        <span className="block text-xs text-foreground-muted">
                          {conversation.messageCount} messages · {conversation.channel}
                          {conversation.lastMessageAt ? (
                            <>
                              {" · "}
                              <AppRelativeTime value={conversation.lastMessageAt} />
                            </>
                          ) : null}
                        </span>
                      </span>
                      <AppBadge tone={conversation.status === "open" ? "info" : conversation.status === "escalated" ? "warning" : "success"} size="sm">
                        {conversation.status}
                      </AppBadge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </AppCardContent>
        </AppCard>
      </div>

      <div className="flex flex-col gap-6">
        <SetupChecklist agent={agent} base={base} />
        <AppCard padding="md" className="flex flex-col gap-3">
          <p className="text-sm font-semibold">Configuration</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-foreground-muted">Model</dt>
            <dd className="truncate">{agent.modelConfig.model || "Workspace default"}</dd>
            <dt className="text-foreground-muted">Memory</dt>
            <dd>{agent.memoryConfig.enabled ? `Last ${agent.memoryConfig.windowMessages} messages` : "Off"}</dd>
            <dt className="text-foreground-muted">Output</dt>
            <dd>{agent.outputSchema ? "Structured JSON" : "Free text"}</dd>
            <dt className="text-foreground-muted">Approval</dt>
            <dd>{agent.requiresApproval ? "Required for every tool call" : "Per tool"}</dd>
            <dt className="text-foreground-muted">Knowledge</dt>
            <dd>
              {agent.collectionCount} base{agent.collectionCount === 1 ? "" : "s"}
            </dd>
            <dt className="text-foreground-muted">Created</dt>
            <dd>
              <AppRelativeTime value={agent.createdAt} />
            </dd>
          </dl>
        </AppCard>
        <AppCard padding="md" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Enabled tools</p>
            <AppButtonLink href={`${base}/tools` as Route} variant="ghost" size="sm">
              Manage
            </AppButtonLink>
          </div>
          {enabledTools.length === 0 ? (
            <p className="text-sm text-foreground-muted">No tools enabled. The agent can only answer from instructions and knowledge.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {enabledTools.map((setting) => {
                const definition = AGENT_TOOLS[setting.toolId];
                const Icon = definition.icon;
                const needsApproval = agent.requiresApproval || setting.requiresApproval;
                return (
                  <li key={setting.toolId} className="flex items-center gap-2 text-sm">
                    <Icon aria-hidden className="size-4 shrink-0 text-foreground-subtle" />
                    <span className="min-w-0 flex-1 truncate">{definition.name}</span>
                    {needsApproval ? (
                      <AppBadge tone="warning" size="sm">
                        Approval
                      </AppBadge>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </AppCard>
      </div>
    </div>
  );
}
