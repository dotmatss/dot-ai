"use client";

import { RefreshCw, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppCheckbox } from "@/components/ui/app-checkbox";
import { AppSelect } from "@/components/ui/app-select";
import { AppSwitch } from "@/components/ui/app-switch";
import { MCP_RISK_CLASSES, type McpRiskClass, type McpToolView } from "@/features/mcp/types";
import { MCP_RISK_META, approvalIsMandatory, defaultRequiresApproval } from "@/features/mcp/constants";
import { useDiscoverMcpToolsMutation, useSetMcpGrantsMutation } from "@/features/mcp/mutations";
import { useMcpToolsQuery } from "@/features/mcp/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";
import { cn } from "@/lib/cn";

/** One row's editable decision. */
interface Draft {
  approved: boolean;
  riskClass: McpRiskClass;
  requiresApproval: boolean;
}

function draftFor(view: McpToolView): Draft {
  if (view.grant) {
    return { approved: true, riskClass: view.grant.riskClass, requiresApproval: view.grant.requiresApproval };
  }
  // Nothing is approved by default, and the suggested class comes from the
  // server's claim, which is advisory only.
  return {
    approved: false,
    riskClass: view.suggestedRiskClass,
    requiresApproval: defaultRequiresApproval(view.suggestedRiskClass),
  };
}



/** The hints the server claims, labelled as claims. */
function AnnotationClaims({ view }: { view: McpToolView }) {
  const claims = view.tool.annotations;
  const entries: string[] = [];
  if (claims.readOnlyHint === true) entries.push("read-only");
  if (claims.destructiveHint === true) entries.push("destructive");
  if (claims.idempotentHint === true) entries.push("idempotent");
  if (claims.openWorldHint === true) entries.push("reaches external systems");

  if (entries.length === 0) return <span className="text-caption text-foreground-subtle">The server claims nothing.</span>;
  return (
    <span className="text-caption text-foreground-subtle">
      The server claims: {entries.join(", ")}. <span className="text-foreground-muted">Unverified.</span>
    </span>
  );
}

/**
 * The approval screen.
 *
 * Three things here are deliberate and should not be "simplified" away.
 *
 * The server's annotations are shown as *claims*, attributed and marked
 * unverified, because the specification requires clients to treat them as
 * untrusted and a server can simply lie. They pre-select the risk class and
 * nothing more.
 *
 * A destructive tool's approval requirement is disabled in the UI and forced
 * on by the server and by a database constraint. Three layers, because this is
 * the control that stops an agent deleting things unattended.
 *
 * A stale tool cannot be saved as approved without the person seeing that it
 * changed. Re-approving is a deliberate act, not a side effect of pressing
 * Save on a screen that looks the same as yesterday.
 */
export function McpToolApprovals({ serverId }: { serverId: string }) {
  const { membership } = useWorkspace();
  const manageable = canManage(membership.role);
  const query = useMcpToolsQuery(serverId);
  const discover = useDiscoverMcpToolsMutation(serverId);
  const save = useSetMcpGrantsMutation(serverId);

  /**
   * Only the rows a person has actually touched.
   *
   * The rest are derived from the server data during render, so there is no
   * effect synchronising two copies of the same state. A background refetch
   * therefore updates untouched rows and leaves edited ones alone, which is
   * better than freezing the whole table the moment one checkbox moves.
   */
  const [overrides, setOverrides] = useState<Record<string, Draft>>({});
  const dirty = Object.keys(overrides).length > 0;

  if (query.isPending) return <AppListSkeleton rows={4} />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const views = query.data;

  function draftOf(view: McpToolView): Draft {
    return overrides[view.tool.name] ?? draftFor(view);
  }

  function update(view: McpToolView, patch: Partial<Draft>) {
    const name = view.tool.name;
    setOverrides((current) => {
      const existing = current[name] ?? draftFor(view);
      const next = { ...existing, ...patch };
      // Changing the class re-applies its approval default, and a destructive
      // class pins approval on.
      if (patch.riskClass && patch.riskClass !== existing.riskClass) {
        next.requiresApproval = defaultRequiresApproval(patch.riskClass);
      }
      if (approvalIsMandatory(next.riskClass)) next.requiresApproval = true;
      return { ...current, [name]: next };
    });
  }

  function onSave() {
    const grants = views
      .map((view) => ({ view, draft: draftOf(view) }))
      .filter(({ draft }) => draft.approved)
      .map(({ view, draft }) => ({
        toolName: view.tool.name,
        riskClass: draft.riskClass,
        requiresApproval: draft.requiresApproval,
      }));
    save.mutate({ grants }, { onSuccess: () => setOverrides({}) });
  }

  const staleCount = views.filter((view) => view.stale).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-foreground-muted">
          Nothing is available to an agent until it is approved here. Approval is pinned to the tool as it is written today.
        </p>
        {manageable ? (
          <AppButton
            variant="secondary"
            size="sm"
            onClick={() => discover.mutate()}
            loading={discover.isPending}
            leadingIcon={<RefreshCw aria-hidden />}
          >
            Refresh tool list
          </AppButton>
        ) : null}
      </div>

      {staleCount > 0 ? (
        <AppAlert tone="warning" title={`${staleCount} approved tool${staleCount === 1 ? "" : "s"} changed`}>
          The server redefined {staleCount === 1 ? "this tool" : "these tools"} after they were approved, so they are not being
          offered to your agents. Read what they do now, then approve again if you are happy with it.
        </AppAlert>
      ) : null}

      {views.length === 0 ? (
        <AppEmptyState
          icon={<ShieldAlert aria-hidden />}
          title="No tools discovered"
          description="Refresh the tool list to read what this server offers. If it stays empty, the server may be offering nothing or rejecting our credential."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {views.map((view) => {
            const draft = draftOf(view);
            const destructive = approvalIsMandatory(draft.riskClass);
            return (
              <li
                key={view.tool.name}
                className={cn(
                  "rounded-lg border bg-surface p-4 shadow-xs",
                  view.stale ? "border-warning-border" : "border-border",
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium text-foreground">{view.tool.name}</span>
                      {view.tool.title ? <span className="text-sm text-foreground-muted">{view.tool.title}</span> : null}
                      {view.stale ? (
                        <AppBadge tone="warning" size="sm" icon={<ShieldAlert aria-hidden />}>
                          Changed since approval
                        </AppBadge>
                      ) : null}
                    </div>
                    {view.tool.description ? (
                      <p className="mt-1.5 max-w-prose whitespace-pre-wrap text-sm leading-6 text-foreground-secondary">
                        {view.tool.description}
                      </p>
                    ) : null}
                    <p className="mt-1.5">
                      <AnnotationClaims view={view} />
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col gap-3 sm:w-56">
                    <AppCheckbox
                      label="Approved"
                      checked={draft.approved}
                      disabled={!manageable || save.isPending}
                      onChange={(event) => update(view, { approved: event.target.checked })}
                    />
                    <AppSelect
                      aria-label={`Risk class for ${view.tool.name}`}
                      value={draft.riskClass}
                      disabled={!manageable || save.isPending}
                      size="sm"
                      onChange={(event) => update(view, { riskClass: event.target.value as McpRiskClass })}
                      options={MCP_RISK_CLASSES.map((riskClass) => ({ value: riskClass, label: MCP_RISK_META[riskClass].label }))}
                    />
                    <AppSwitch
                      label="Ask a person first"
                      description={
                        destructive ? "Always required for destructive tools." : MCP_RISK_META[draft.riskClass].description
                      }
                      checked={draft.requiresApproval}
                      disabled={!manageable || destructive || save.isPending}
                      onCheckedChange={(checked) => update(view, { requiresApproval: checked })}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {manageable && views.length > 0 ? (
        <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
          {dirty ? <span className="text-xs text-foreground-muted">Unsaved changes</span> : null}
          <AppButton onClick={onSave} loading={save.isPending} disabled={!dirty}>
            Save approvals
          </AppButton>
        </div>
      ) : null}
    </div>
  );
}
