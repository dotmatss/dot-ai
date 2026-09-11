"use client";

import { RotateCcw, Wrench } from "lucide-react";
import type { Route } from "next";
import { useMemo } from "react";

import { ChatComposer } from "@/components/chat/chat-composer";
import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton, AppButtonLink } from "@/components/ui/app-button";
import { AppCard } from "@/components/ui/app-card";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { agentsApi } from "@/features/agents/api";
import { ChatThread } from "@/components/chat/chat-thread";
import { AgentToolSteps } from "@/features/agents/components/agent-tool-steps";
import { useChatStream } from "@/hooks/use-chat-stream";
import { useAgentQuery } from "@/features/agents/queries";
import { AGENT_TOOLS } from "@/features/agents/tools/registry";
import type { Agent } from "@/features/agents/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

function Playground({ agent }: { agent: Agent }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const endpoint = useMemo(() => agentsApi.chatUrl(membership.workspace.slug, agent.id), [membership.workspace.slug, agent.id]);
  const chat = useChatStream({ endpoint });
  const enabledTools = agent.tools.filter((tool) => tool.enabled);
  const base = `/w/${membership.workspace.slug}/agents/${agent.id}`;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <AppCard className="flex h-[640px] flex-col lg:col-span-2">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Test run</p>
            <AppBadge tone={chat.status === "streaming" ? "info" : chat.status === "error" ? "danger" : "neutral"} size="sm" dot>
              {chat.status === "streaming" ? "Working" : chat.status === "error" ? "Error" : "Idle"}
            </AppBadge>
          </div>
          <AppButton variant="ghost" size="sm" onClick={chat.reset} leadingIcon={<RotateCcw aria-hidden />} disabled={chat.turns.length === 0}>
            New run
          </AppButton>
        </div>
        <div className="flex-1 overflow-y-auto bg-background px-4 py-4 scrollbar-thin">
          {chat.turns.length === 0 ? (
            <AppEmptyState
              size="sm"
              icon={<Wrench aria-hidden />}
              title="Give the agent a task"
              description="Describe what you want done. Tool requests appear inline with their status, so you can see what the agent would do before it can do it."
            />
          ) : (
            <ChatThread
              turns={chat.turns}
              onRetry={chat.retry}
              assistantName={agent.name}
              renderToolActivity={(activity) => <AgentToolSteps activity={activity} agentName={agent.name} />}
            />
          )}
        </div>
        <div className="border-t border-border p-3">
          {!editable ? (
            <AppAlert tone="neutral">Viewers can read this agent but only members can start a test run.</AppAlert>
          ) : (
            <ChatComposer
              onSend={(text) => void chat.send(text)}
              onStop={chat.stop}
              streaming={chat.status === "streaming"}
              placeholder="Ask the agent to do something…"
            />
          )}
        </div>
      </AppCard>

      <div className="flex flex-col gap-4">
        <AppAlert tone="info" title="About the playground">
          Runs use the saved instructions, model settings, memory window and attached knowledge. Conversations are stored on the “agent” channel with
          this agent attached, so they show up in the inbox and in reports.
        </AppAlert>
        <AppAlert tone="warning" title="Tools are not executed">
          The agent may request a tool; the request is recorded with its status and reason, and nothing runs. That keeps testing free of side effects
          such as sent email or created records.
        </AppAlert>
        <AppCard padding="md" className="flex flex-col gap-2 text-sm">
          <p className="font-semibold">Active configuration</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-foreground-muted">Model</dt>
            <dd className="truncate">{agent.modelConfig.model || "Workspace default"}</dd>
            <dt className="text-foreground-muted">Temperature</dt>
            <dd className="tabular-nums">{agent.modelConfig.temperature}</dd>
            <dt className="text-foreground-muted">Max tokens</dt>
            <dd className="tabular-nums">{agent.modelConfig.maxTokens}</dd>
            <dt className="text-foreground-muted">Memory</dt>
            <dd>{agent.memoryConfig.enabled ? `Last ${agent.memoryConfig.windowMessages} messages` : "Off"}</dd>
            <dt className="text-foreground-muted">Output</dt>
            <dd>{agent.outputSchema ? "Structured JSON" : "Free text"}</dd>
            <dt className="text-foreground-muted">Knowledge</dt>
            <dd>{agent.knowledgeBaseCount === 0 ? "None attached" : `${agent.knowledgeBaseCount} attached`}</dd>
          </dl>
        </AppCard>
        <AppCard padding="md" className="flex flex-col gap-2 text-sm">
          <p className="font-semibold">Tools in this run</p>
          {enabledTools.length === 0 ? (
            <>
              <p className="text-foreground-muted">No tools enabled, so the agent can only answer from its instructions and knowledge.</p>
              <AppButtonLink href={`${base}/tools` as Route} variant="secondary" size="sm">
                Enable tools
              </AppButtonLink>
            </>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {enabledTools.map((setting) => (
                <li key={setting.toolId} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{AGENT_TOOLS[setting.toolId].name}</span>
                  {agent.requiresApproval || setting.requiresApproval ? (
                    <AppBadge tone="warning" size="sm">
                      Approval
                    </AppBadge>
                  ) : (
                    <AppBadge tone="info" size="sm">
                      Simulated
                    </AppBadge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </AppCard>
      </div>
    </div>
  );
}

export function AgentPlayground({ agentId }: { agentId: string }) {
  const query = useAgentQuery(agentId);
  if (query.isPending) return <AppSkeleton className="h-[640px]" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <Playground agent={query.data} />;
}
