"use client";

import { Cpu, Network, ShieldCheck } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppFormActions, AppFormField, AppFormSection } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppCheckbox } from "@/components/ui/app-checkbox";
import { AppInput } from "@/components/ui/app-input";
import { AppSwitch } from "@/components/ui/app-switch";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { DELEGATION_CEILINGS, delegationConfigFormSchema, type DelegationConfigFormValues } from "@/features/agents/delegation-limits";
import { useUpdateAgentMutation } from "@/features/agents/mutations";
import { useAgentDelegatesQuery, useAgentQuery } from "@/features/agents/queries";
import type { Agent, DelegationCandidate } from "@/features/agents/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

/**
 * Dynamic delegation.
 *
 * A capability on an ordinary agent, not a kind of agent: the same agent can be
 * used on its own, placed in a workflow, granted to another agent as a target,
 * and - if this switch is on - allowed to hand a task to explicitly authorized
 * agents while it runs. This tab holds that switch, who it may ask, and how
 * much it may spend doing so.
 */

/** Root → children. Enough to answer "who can this agent call?" at a glance. */
function DelegationTree({ agent, delegates }: { agent: Agent; delegates: DelegationCandidate[] }) {
  const { membership } = useWorkspace();
  if (delegates.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-muted p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Cpu aria-hidden className="size-4 text-foreground-secondary" />
        {agent.name}
      </div>
      <ul className="mt-1 flex flex-col">
        {delegates.map((child, index) => (
          <li key={child.id} className="flex items-center gap-2 pl-2 text-sm text-foreground-secondary">
            <span aria-hidden className="font-mono text-foreground-subtle">
              {index === delegates.length - 1 ? "└─" : "├─"}
            </span>
            <Link
              href={`/w/${membership.workspace.slug}/agents/${child.id}` as Route}
              className="rounded underline-offset-4 hover:underline focus-ring"
            >
              {child.name}
            </Link>
            {child.canDelegate ? (
              <AppBadge tone="info" size="sm">
                Delegates
              </AppBadge>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DelegationForm({ agent, candidates }: { agent: Agent; candidates: DelegationCandidate[] }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const update = useUpdateAgentMutation(agent.id);

  const [canDelegate, setCanDelegate] = useState(agent.canDelegate);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(agent.delegateIds));
  const [limits, setLimits] = useState(agent.delegationConfig);
  // Same schema the server parses the patch with, run before sending, so a
  // value outside a ceiling is explained next to its field rather than as a
  // 422 the form has nowhere to show.
  const [limitErrors, setLimitErrors] = useState<Partial<Record<keyof DelegationConfigFormValues, string>>>({});

  function setLimit<K extends keyof DelegationConfigFormValues>(key: K, value: number) {
    setLimits((current) => ({ ...current, [key]: value }));
    setLimitErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }

  const granted = candidates.filter((candidate) => selected.has(candidate.id));
  const savedIds = [...agent.delegateIds].sort().join(",");
  const dirty =
    canDelegate !== agent.canDelegate ||
    [...selected].sort().join(",") !== savedIds ||
    limits.maxDepth !== agent.delegationConfig.maxDepth ||
    limits.maxDelegations !== agent.delegationConfig.maxDelegations ||
    limits.timeoutMs !== agent.delegationConfig.timeoutMs ||
    limits.tokenBudget !== agent.delegationConfig.tokenBudget;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = delegationConfigFormSchema.safeParse(limits);
    if (!parsed.success) {
      const next: Partial<Record<keyof DelegationConfigFormValues, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof DelegationConfigFormValues | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setLimitErrors(next);
      return;
    }
    update.mutate({
      canDelegate,
      // Sent either way, so switching the capability off also releases the
      // grants rather than leaving them live but unreachable.
      delegateIds: canDelegate ? [...selected] : [],
      delegationConfig: parsed.data,
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset disabled={!editable} className="min-w-0">
        <AppFormSection
          title="Dynamic delegation"
          description="Let this agent hand part of a task to other agents while it works, and answer from what they report back. The model decides when; you decide who."
        >
          <AppSwitch
            id="can-delegate"
            checked={canDelegate}
            onCheckedChange={setCanDelegate}
            label="Allow this agent to delegate"
            description="Only to the agents you authorize below. Off by default; nothing else about the agent changes."
          />

          {canDelegate ? (
            <AppAlert tone="info" title="What delegation does not share">
              Delegating runs the other agent on <strong>its</strong> instructions, knowledge, tools and approvals. This
              agent receives only that agent&rsquo;s answer — never its credentials, its connections or its permissions.
              Agents that delegate cannot be deployed to a public chatbot.
            </AppAlert>
          ) : null}
        </AppFormSection>

        {canDelegate ? (
          <>
            <AppFormSection
              title="Delegated agents"
              description="Only the agents you tick here can be asked. Everything else in the workspace stays out of reach."
            >
              {candidates.length === 0 ? (
                <p className="text-sm text-foreground-muted">
                  There are no other agents in this workspace yet. Create one, then authorize it here.
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-3">
                    {candidates.map((candidate) => (
                      <AppCheckbox
                        key={candidate.id}
                        checked={selected.has(candidate.id)}
                        onChange={() => toggle(candidate.id)}
                        label={
                          <span className="flex flex-wrap items-center gap-1.5">
                            {candidate.name}
                            {candidate.canDelegate ? (
                              <AppBadge tone="info" size="sm">
                                Delegates
                              </AppBadge>
                            ) : null}
                            {candidate.status !== "active" ? (
                              <AppBadge tone="neutral" size="sm">
                                {candidate.status}
                              </AppBadge>
                            ) : null}
                          </span>
                        }
                        description={candidate.description ?? undefined}
                      />
                    ))}
                  </div>
                  <DelegationTree agent={agent} delegates={granted} />
                </>
              )}
            </AppFormSection>

            <AppFormSection
              title="Execution limits"
              description="Enforced by the server on every delegation, not requested of the model. A request that reaches a limit is refused and the agent is told."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <AppFormField
                  label="Maximum depth"
                  description={`How many levels deep delegation may go. Up to ${DELEGATION_CEILINGS.maxDepth}.`}
                  error={limitErrors.maxDepth}
                >
                  {(field) => (
                    <AppInput
                      {...field}
                      type="number"
                      min={1}
                      max={DELEGATION_CEILINGS.maxDepth}
                      value={limits.maxDepth}
                      onChange={(event) => setLimit("maxDepth", Number(event.target.value))}
                    />
                  )}
                </AppFormField>
                <AppFormField
                  label="Agents per request"
                  description={`Child runs allowed in one request. Up to ${DELEGATION_CEILINGS.maxDelegations}.`}
                  error={limitErrors.maxDelegations}
                >
                  {(field) => (
                    <AppInput
                      {...field}
                      type="number"
                      min={1}
                      max={DELEGATION_CEILINGS.maxDelegations}
                      value={limits.maxDelegations}
                      onChange={(event) => setLimit("maxDelegations", Number(event.target.value))}
                    />
                  )}
                </AppFormField>
                <AppFormField
                  label="Time limit (ms)"
                  description={`Wall clock for the whole request. Up to ${DELEGATION_CEILINGS.timeoutMs.toLocaleString()}.`}
                  error={limitErrors.timeoutMs}
                >
                  {(field) => (
                    <AppInput
                      {...field}
                      type="number"
                      step={1000}
                      min={5000}
                      max={DELEGATION_CEILINGS.timeoutMs}
                      value={limits.timeoutMs}
                      onChange={(event) => setLimit("timeoutMs", Number(event.target.value))}
                    />
                  )}
                </AppFormField>
                <AppFormField
                  label="Token budget"
                  description={`Shared by every agent in the request. Up to ${DELEGATION_CEILINGS.tokenBudget.toLocaleString()}.`}
                  error={limitErrors.tokenBudget}
                >
                  {(field) => (
                    <AppInput
                      {...field}
                      type="number"
                      step={1000}
                      min={1000}
                      max={DELEGATION_CEILINGS.tokenBudget}
                      value={limits.tokenBudget}
                      onChange={(event) => setLimit("tokenBudget", Number(event.target.value))}
                    />
                  )}
                </AppFormField>
              </div>
              <p className="flex items-start gap-2 text-xs text-foreground-muted">
                <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                Delegation runs inside the request, so these bounds are what keep one question from becoming an unbounded
                number of model calls. Long-running orchestration needs background execution, which this release does not have.
              </p>
            </AppFormSection>
          </>
        ) : null}

        {editable ? (
          <AppFormActions>
            <AppButton
              type="button"
              variant="secondary"
              onClick={() => {
                setCanDelegate(agent.canDelegate);
                setSelected(new Set(agent.delegateIds));
                setLimits(agent.delegationConfig);
                setLimitErrors({});
              }}
              disabled={!dirty || update.isPending}
            >
              Discard
            </AppButton>
            <AppButton type="submit" loading={update.isPending} disabled={!dirty}>
              Save changes
            </AppButton>
          </AppFormActions>
        ) : null}
      </fieldset>
    </form>
  );
}

export function AgentDelegationPanel({ agentId }: { agentId: string }) {
  const agentQuery = useAgentQuery(agentId);
  const candidatesQuery = useAgentDelegatesQuery(agentId);

  if (agentQuery.isPending || candidatesQuery.isPending) return <AppSkeleton className="h-96" />;
  if (agentQuery.isError) return <AppErrorState error={agentQuery.error} onRetry={() => void agentQuery.refetch()} />;
  if (candidatesQuery.isError) return <AppErrorState error={candidatesQuery.error} onRetry={() => void candidatesQuery.refetch()} />;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm text-foreground-muted">
        <Network aria-hidden className="size-4" />
        <span>Delegation is server-authorized: an agent not ticked here cannot be called, whatever the model asks for. Composing agents in a fixed order is done in a Workflow instead.</span>
      </div>
      <DelegationForm
        // Re-seeded whenever the saved configuration changes.
        key={`${agentQuery.data.canDelegate}:${agentQuery.data.delegateIds.join(",")}`}
        agent={agentQuery.data}
        candidates={candidatesQuery.data}
      />
    </div>
  );
}
