"use client";

import { Plug, ShieldCheck } from "lucide-react";
import type { Route } from "next";
import { useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton, AppButtonLink } from "@/components/ui/app-button";
import { AppCard } from "@/components/ui/app-card";
import { AppCheckbox } from "@/components/ui/app-checkbox";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppSwitch } from "@/components/ui/app-switch";
import { useUpdateAgentMutation } from "@/features/agents/mutations";
import type { Agent } from "@/features/agents/types";
import { MCP_RISK_META } from "@/features/mcp/constants";
import { useAgentQuery } from "@/features/agents/queries";
import { useAttachableMcpToolsQuery } from "@/features/mcp/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

/**
 * Which of the workspace's approved MCP tools this agent offers.
 *
 * A sibling of the built-in tools panel rather than part of it, because the
 * two answer different questions. A built-in tool is configured; an MCP tool
 * is *selected* from what somebody already approved, and the list here is
 * therefore whatever the workspace has granted — never everything a server
 * offers.
 *
 * Granting is not attaching. This screen cannot approve anything, and the
 * per-tool approval switch can only ever make a call *more* supervised: where
 * the grant already forces approval, the switch is on and disabled, because
 * an agent-level setting must not be able to relax a workspace-level decision.
 */
export function AgentMcpToolsPanel({ agentId }: { agentId: string }) {
  const agentQuery = useAgentQuery(agentId);
  if (agentQuery.isPending) return <AppSkeleton className="h-40 w-full" />;
  if (agentQuery.isError) return <AppErrorState error={agentQuery.error} onRetry={() => void agentQuery.refetch()} />;
  return <Panel agent={agentQuery.data} />;
}

function Panel({ agent }: { agent: Agent }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const query = useAttachableMcpToolsQuery();
  const update = useUpdateAgentMutation(agent.id);

  // Drafts derived from props plus the edits made since, rather than copied
  // into state in an effect: a background refetch must not discard what
  // somebody is in the middle of choosing.
  const [edits, setEdits] = useState<Record<string, { enabled: boolean; requiresApproval: boolean }>>({});

  const stored = new Map(agent.mcpTools.map((entry) => [`${entry.serverSlug}.${entry.toolName}`, entry]));
  const keyOf = (serverSlug: string, toolName: string) => `${serverSlug}.${toolName}`;

  const mcpBase = `/w/${membership.workspace.slug}/integrations/mcp` as Route;

  if (query.isPending) return <AppSkeleton className="h-40 w-full" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const available = query.data;

  if (available.length === 0) {
    return (
      <AppCard>
        <AppEmptyState
          icon={<Plug aria-hidden />}
          title="No approved MCP tools"
          description="Connect an MCP server and approve the tools you want available. Nothing a server offers reaches an agent until somebody approves it."
          action={
            <AppButtonLink href={mcpBase} variant="secondary">
              Manage MCP servers
            </AppButtonLink>
          }
        />
      </AppCard>
    );
  }

  const valueFor = (serverSlug: string, toolName: string, approvalIsForced: boolean) => {
    const key = keyOf(serverSlug, toolName);
    const edit = edits[key];
    const saved = stored.get(key);
    const enabled = edit?.enabled ?? saved?.enabled ?? false;
    const requiresApproval = approvalIsForced || (edit?.requiresApproval ?? saved?.requiresApproval ?? false);
    return { enabled, requiresApproval };
  };

  const set = (serverSlug: string, toolName: string, patch: Partial<{ enabled: boolean; requiresApproval: boolean }>) => {
    const key = keyOf(serverSlug, toolName);
    const current = valueFor(serverSlug, toolName, false);
    setEdits((previous) => ({ ...previous, [key]: { ...current, ...patch } }));
  };

  const dirty = Object.keys(edits).length > 0;

  const save = () => {
    // Everything currently attached is submitted, not just what changed: the
    // column is replaced outright, so a partial list would detach the rest.
    const mcpTools = available
      .map((tool) => {
        const value = valueFor(tool.serverSlug, tool.toolName, tool.approvalIsForced);
        return {
          source: "mcp" as const,
          serverSlug: tool.serverSlug,
          toolName: tool.toolName,
          enabled: value.enabled,
          requiresApproval: value.requiresApproval,
        };
      })
      // A tool nobody attached is simply absent, which keeps the column from
      // filling up with rows meaning "no".
      .filter((entry) => entry.enabled);

    update.mutate(
      { mcpTools },
      {
        onSuccess: () => setEdits({}),
      },
    );
  };

  const byServer = new Map<string, typeof available>();
  for (const tool of available) {
    byServer.set(tool.serverName, [...(byServer.get(tool.serverName) ?? []), tool]);
  }

  const attachedCount = available.filter((tool) => valueFor(tool.serverSlug, tool.toolName, tool.approvalIsForced).enabled).length;

  return (
    <AppCard padding="md" className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">MCP tools</h3>
          <p className="text-sm text-foreground-muted">
            Tools from connected servers that this workspace has approved. Choose which ones this agent may use.
          </p>
        </div>
        <AppAlert tone="info" title={`${attachedCount} of ${available.length} approved tools attached`}>
          A tool reaches this agent only if the workspace approved it, the approval still matches the tool as the server
          defines it now, and you switch it on here.
        </AppAlert>

        {[...byServer.entries()].map(([serverName, tools]) => (
          <section key={serverName} className="flex flex-col gap-2">
            <h4 className="text-sm font-medium text-foreground">{serverName}</h4>
            <ul className="flex flex-col gap-2">
              {tools.map((tool) => {
                const value = valueFor(tool.serverSlug, tool.toolName, tool.approvalIsForced);
                const risk = MCP_RISK_META[tool.riskClass];
                return (
                  <li key={tool.ref} className="rounded-lg border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <AppCheckbox
                        label={
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{tool.toolName}</span>
                            <AppBadge tone={risk.tone}>{risk.label}</AppBadge>
                          </span>
                        }
                        description={tool.description ?? "The server supplied no description."}
                        checked={value.enabled}
                        disabled={!editable}
                        onChange={(event) => set(tool.serverSlug, tool.toolName, { enabled: event.target.checked })}
                      />
                      {value.enabled ? (
                        <AppSwitch
                          label="Ask a person first"
                          checked={value.requiresApproval}
                          // Forced on by the grant: an agent setting must not be
                          // able to relax a workspace decision.
                          disabled={!editable || tool.approvalIsForced}
                          onCheckedChange={(next) => set(tool.serverSlug, tool.toolName, { requiresApproval: next })}
                        />
                      ) : null}
                    </div>
                    {tool.approvalIsForced && value.enabled ? (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground-muted">
                        <ShieldCheck aria-hidden className="size-3.5" />
                        This tool always waits for a person, because of how it was approved.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {editable ? (
          <div className="flex justify-end gap-2">
            <AppButton variant="secondary" onClick={() => setEdits({})} disabled={!dirty || update.isPending}>
              Reset
            </AppButton>
            <AppButton onClick={save} disabled={!dirty} loading={update.isPending}>
              Save MCP tools
            </AppButton>
          </div>
        ) : null}
      </div>
    </AppCard>
  );
}
