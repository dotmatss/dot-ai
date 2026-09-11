"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { MCP_RISK_META } from "@/features/mcp/constants";
import { useDecideMcpCallMutation } from "@/features/mcp/mutations";
import { useMcpApprovalsQuery } from "@/features/mcp/queries";
import type { McpToolCall } from "@/features/mcp/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";

/**
 * Tool calls waiting for a person.
 *
 * The design problem here is that approving must be an *informed* act. A row
 * therefore shows the four things a decision actually rests on — which tool,
 * on which server, asked for by which agent, and with exactly what arguments —
 * rather than a summary that would require trusting this screen.
 *
 * Approving is confirmed twice for a destructive tool, because "delete" and
 * "search" should not be one click apart.
 */
export function McpApprovalsQueue() {
  const { membership } = useWorkspace();
  const manageable = canManage(membership.role);
  const query = useMcpApprovalsQuery();
  const decide = useDecideMcpCallMutation();
  const [confirming, setConfirming] = useState<McpToolCall | null>(null);

  if (query.isPending) return <AppListSkeleton rows={2} />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const calls = query.data;

  if (calls.length === 0) {
    return (
      <AppEmptyState
        icon={<CheckCircle2 aria-hidden />}
        title="Nothing waiting"
        description="When an agent asks for a tool that needs a person, it will appear here and wait. Nothing runs until you decide."
      />
    );
  }

  const submit = (call: McpToolCall, decision: "approve" | "deny") => {
    decide.mutate({ callId: call.id, decision });
    setConfirming(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <AppAlert tone="warning" title={`${calls.length} tool call${calls.length === 1 ? "" : "s"} waiting`}>
        Approving authorises one call. It is re-checked first, so a tool whose approval was revoked or whose definition changed while it waited
        will still be refused.
      </AppAlert>

      <ul className="flex flex-col gap-3">
        {calls.map((call) => {
          const risk = call.riskClass ? MCP_RISK_META[call.riskClass] : null;
          return (
            <li key={call.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                    <span className="truncate">{call.toolName}</span>
                    {risk ? <AppBadge tone={risk.tone}>{risk.label}</AppBadge> : null}
                  </p>
                  <p className="mt-1 text-sm text-foreground-muted">
                    on {call.serverName ?? "a server that has since been removed"}
                    {call.agentName ? `, asked for by ${call.agentName}` : null} ·{" "}
                    <AppRelativeTime value={call.createdAt} />
                  </p>
                </div>

                {manageable ? (
                  <div className="flex shrink-0 gap-2">
                    <AppButton variant="secondary" size="sm" onClick={() => submit(call, "deny")} disabled={decide.isPending}>
                      Deny
                    </AppButton>
                    <AppButton
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => (call.riskClass === "destructive" ? setConfirming(call) : submit(call, "approve"))}
                    >
                      Approve and run
                    </AppButton>
                  </div>
                ) : (
                  <AppBadge tone="neutral">Admins decide</AppBadge>
                )}
              </div>

              <div className="mt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">Arguments it would send</p>
                {/* Shown verbatim. A summary would mean approving something
                    other than what will be sent. */}
                <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-surface-muted p-3 text-xs text-foreground">
                  {JSON.stringify(call.arguments, null, 2)}
                </pre>
              </div>
            </li>
          );
        })}
      </ul>

      <AppConfirmDialog
        open={confirming !== null}
        title={`Run ${confirming?.toolName ?? "this tool"}?`}
        description={
          `This tool is classified destructive: it deletes data, sends something, or does something that cannot be undone. ` +
          `It will run against ${confirming?.serverName ?? "the connected server"} with the arguments shown.`
        }
        confirmLabel="Run it"
        destructive
        loading={decide.isPending}
        onConfirm={() => (confirming ? submit(confirming, "approve") : undefined)}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}
