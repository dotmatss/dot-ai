"use client";

import { ArrowUpRight, BookOpen, Check, Circle, Globe, MessagesSquare, Sparkles } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButtonLink } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardDescription, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppStat } from "@/components/ui/app-stat";
import { useChatbotOverviewQuery, useChatbotQuery } from "@/features/chatbots/queries";
import type { Chatbot } from "@/features/chatbots/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { cn } from "@/lib/cn";
import { AppRelativeTime } from "@/components/ui/app-relative-time";

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function SetupChecklist({ chatbot, base }: { chatbot: Chatbot; base: string }) {
  const steps = [
    { done: chatbot.instructions.trim().length > 0, label: "Write instructions", href: `${base}/instructions`, icon: Sparkles },
    { done: chatbot.knowledgeBaseIds.length > 0, label: "Attach a knowledge base", href: `${base}/knowledge`, icon: BookOpen },
    { done: chatbot.allowedDomains.length > 0, label: "Allow your website domain", href: `${base}/deploy`, icon: Globe },
    { done: chatbot.status === "active", label: "Activate the chatbot", href: `${base}/deploy`, icon: Check },
  ];
  const completed = steps.filter((s) => s.done).length;
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

export function ChatbotOverview({ chatbotId }: { chatbotId: string }) {
  const { membership } = useWorkspace();
  const chatbotQuery = useChatbotQuery(chatbotId);
  const overviewQuery = useChatbotOverviewQuery(chatbotId);
  const base = `/w/${membership.workspace.slug}/chatbots/${chatbotId}`;
  const inboxHref = `/w/${membership.workspace.slug}/conversations?chatbotId=${chatbotId}` as Route;

  if (chatbotQuery.isPending) {
    return <AppSkeleton className="h-64" />;
  }
  if (chatbotQuery.isError) {
    return <AppErrorState error={chatbotQuery.error} onRetry={() => void chatbotQuery.refetch()} />;
  }
  const chatbot = chatbotQuery.data;
  const overview = overviewQuery.data;

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
          ) : (
            <>
              <AppStat
                label="Conversations · last 7 days"
                value={overview!.conversationsLast7Days}
                delta={percentChange(overview!.conversationsLast7Days, overview!.conversationsPrevious7Days)}
                deltaLabel="vs previous 7 days"
              />
              <AppStat
                label="Messages · last 7 days"
                value={overview!.messagesLast7Days}
                delta={percentChange(overview!.messagesLast7Days, overview!.messagesPrevious7Days)}
                deltaLabel="vs previous 7 days"
              />
            </>
          )}
        </div>

        <AppCard>
          <AppCardHeader>
            <div>
              <AppCardTitle>Recent conversations</AppCardTitle>
              <AppCardDescription>Latest visitor and playground sessions with this chatbot.</AppCardDescription>
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
                description="Test the chatbot in the playground or embed it on your site to start collecting conversations."
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
                      className="flex items-center gap-3 py-3 text-sm hover:bg-surface-hover focus-ring rounded-md -mx-2 px-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{conversation.title ?? "Untitled conversation"}</span>
                        <span className="block text-xs text-foreground-muted">
                          {conversation.messageCount} messages · {conversation.channel}
                          {conversation.lastMessageAt ? <> · <AppRelativeTime value={conversation.lastMessageAt} /></> : null}
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
        <SetupChecklist chatbot={chatbot} base={base} />
        <AppCard padding="md" className="flex flex-col gap-3">
          <p className="text-sm font-semibold">Details</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-foreground-muted">Model</dt>
            <dd className="truncate">{chatbot.modelConfig.model || "Workspace default"}</dd>
            <dt className="text-foreground-muted">Knowledge</dt>
            <dd>{chatbot.knowledgeBaseCount} base{chatbot.knowledgeBaseCount === 1 ? "" : "s"}</dd>
            <dt className="text-foreground-muted">Domains</dt>
            <dd>{chatbot.allowedDomains.length === 0 ? "None allowed" : chatbot.allowedDomains.join(", ")}</dd>
            <dt className="text-foreground-muted">Created</dt>
            <dd><AppRelativeTime value={chatbot.createdAt} /></dd>
          </dl>
        </AppCard>
      </div>
    </div>
  );
}
