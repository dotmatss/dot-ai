"use client";

import { RotateCcw } from "lucide-react";
import { useMemo } from "react";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppCard } from "@/components/ui/app-card";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { chatbotsApi } from "@/features/chatbots/api";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatThread } from "@/components/chat/chat-thread";
import { useChatStream } from "@/hooks/use-chat-stream";
import { useChatbotQuery } from "@/features/chatbots/queries";
import type { Chatbot } from "@/features/chatbots/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

function Playground({ chatbot }: { chatbot: Chatbot }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const endpoint = useMemo(() => chatbotsApi.chatUrl(membership.workspace.slug, chatbot.id), [membership.workspace.slug, chatbot.id]);
  const chat = useChatStream({ endpoint, welcomeMessage: chatbot.welcomeMessage });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <AppCard className="flex h-[640px] flex-col lg:col-span-2">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Test conversation</p>
            <AppBadge tone={chat.status === "streaming" ? "info" : chat.status === "error" ? "danger" : "neutral"} size="sm" dot>
              {chat.status === "streaming" ? "Responding" : chat.status === "error" ? "Error" : "Idle"}
            </AppBadge>
          </div>
          <AppButton variant="ghost" size="sm" onClick={chat.reset} leadingIcon={<RotateCcw aria-hidden />} disabled={chat.turns.length <= 1}>
            New conversation
          </AppButton>
        </div>
        <div className="flex-1 overflow-y-auto bg-background px-4 py-4 scrollbar-thin">
          <ChatThread turns={chat.turns} onRetry={chat.retry} assistantName={chatbot.name} accentColor={chatbot.appearance.primaryColor} />
        </div>
        <div className="border-t border-border p-3">
          {!editable ? (
            <AppAlert tone="neutral">Viewers can read this chatbot but only members can send test messages.</AppAlert>
          ) : (
            <ChatComposer onSend={(text) => void chat.send(text)} onStop={chat.stop} streaming={chat.status === "streaming"} placeholder="Ask the chatbot something…" />
          )}
        </div>
      </AppCard>
      <div className="flex flex-col gap-4">
        <AppAlert tone="info" title="About the playground">
          Messages here use the saved instructions, model settings and attached knowledge. Conversations are stored with the
          “playground” channel so they never mix with visitor traffic in reports.
        </AppAlert>
        <AppCard padding="md" className="flex flex-col gap-2 text-sm">
          <p className="font-semibold">Active configuration</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-foreground-muted">Model</dt>
            <dd>{chatbot.modelConfig.model || "Workspace default"}</dd>
            <dt className="text-foreground-muted">Temperature</dt>
            <dd className="tabular-nums">{chatbot.modelConfig.temperature}</dd>
            <dt className="text-foreground-muted">Max tokens</dt>
            <dd className="tabular-nums">{chatbot.modelConfig.maxTokens}</dd>
            <dt className="text-foreground-muted">Knowledge</dt>
            <dd>{chatbot.collectionCount === 0 ? "None attached" : `${chatbot.collectionCount} attached`}</dd>
          </dl>
        </AppCard>
      </div>
    </div>
  );
}

export function ChatbotPlayground({ chatbotId }: { chatbotId: string }) {
  const query = useChatbotQuery(chatbotId);
  if (query.isPending) return <AppSkeleton className="h-[640px]" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <Playground chatbot={query.data} />;
}
