"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Braces, ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppFormActions, AppFormField, AppFormSection } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { AppCodeBlock } from "@/components/ui/app-code-block";
import { AppInput } from "@/components/ui/app-input";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppSwitch } from "@/components/ui/app-switch";
import { AppTextarea } from "@/components/ui/app-textarea";
import { EXAMPLE_OUTPUT_SCHEMA, MEMORY_WINDOW_LIMITS, OUTPUT_SCHEMA_MAX_LENGTH } from "@/features/agents/constants";
import { useUpdateAgentMutation } from "@/features/agents/mutations";
import { useAgentQuery } from "@/features/agents/queries";
import { agentMemoryFormSchema, type AgentMemoryFormValues } from "@/features/agents/schemas";
import type { Agent } from "@/features/agents/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

const EXAMPLE_SCHEMA_TEXT = JSON.stringify(EXAMPLE_OUTPUT_SCHEMA, null, 2);

function toFormValues(agent: Agent): AgentMemoryFormValues {
  return {
    memoryEnabled: agent.memoryConfig.enabled,
    windowMessages: agent.memoryConfig.windowMessages,
    summarize: agent.memoryConfig.summarize,
    requiresApproval: agent.requiresApproval,
    outputSchemaText: agent.outputSchema ? JSON.stringify(agent.outputSchema, null, 2) : "",
  };
}

function MemoryOutputForm({ agent }: { agent: Agent }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const update = useUpdateAgentMutation(agent.id);
  const form = useForm<AgentMemoryFormValues>({
    resolver: zodResolver(agentMemoryFormSchema),
    defaultValues: toFormValues(agent),
  });

  // Keyed on the record id rather than its updatedAt: remounting whenever any
  // sibling mutation touches the record (a status toggle in the header, say)
  // would throw away whatever the user is typing. Reconcile instead, and only
  // when there is nothing to lose.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(toFormValues(agent));
  }, [agent, form]);

  const memoryEnabled = useWatch({ control: form.control, name: "memoryEnabled" });
  const summarize = useWatch({ control: form.control, name: "summarize" });
  const requiresApproval = useWatch({ control: form.control, name: "requiresApproval" });
  const outputSchemaText = useWatch({ control: form.control, name: "outputSchemaText" });

  const onSubmit = form.handleSubmit((values) => {
    update.mutate(
      {
        memoryConfig: { enabled: values.memoryEnabled, windowMessages: values.windowMessages, summarize: values.summarize },
        requiresApproval: values.requiresApproval,
        outputSchema: values.outputSchemaText.trim() === "" ? null : values.outputSchemaText,
      },
      {
        onSuccess: (updated) => form.reset(toFormValues(updated)),
        onError: (error) => {
          if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
        },
      },
    );
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset disabled={!editable} className="min-w-0">
        <AppFormSection
          title="Memory"
          description="How much of the conversation the agent sees on each turn. A smaller window costs less and keeps the agent focused; a larger one keeps context across a long task."
        >
          <AppSwitch
            id="memory-enabled"
            checked={memoryEnabled}
            onCheckedChange={(checked) => form.setValue("memoryEnabled", checked, { shouldDirty: true })}
            disabled={!editable}
            label="Remember the conversation"
            description="Off means the agent only sees the newest message on every run."
          />
          <AppFormField
            label="Window size"
            description={`Messages kept verbatim (${MEMORY_WINDOW_LIMITS.min}–${MEMORY_WINDOW_LIMITS.max}).`}
            error={form.formState.errors.windowMessages?.message}
          >
            {(field) => (
              <AppInput
                {...field}
                {...form.register("windowMessages", { valueAsNumber: true })}
                type="number"
                min={MEMORY_WINDOW_LIMITS.min}
                max={MEMORY_WINDOW_LIMITS.max}
                step="1"
                inputMode="numeric"
                disabled={!editable || !memoryEnabled}
              />
            )}
          </AppFormField>
          <AppSwitch
            id="memory-summarize"
            checked={summarize}
            onCheckedChange={(checked) => form.setValue("summarize", checked, { shouldDirty: true })}
            disabled={!editable || !memoryEnabled}
            label="Summarize older messages"
            description="Messages that fall outside the window are condensed into a short recap instead of being dropped."
          />
        </AppFormSection>

        <AppFormSection
          title="Structured output"
          description="Give the agent a JSON Schema when another system consumes its answer. The schema is added to the system prompt and the agent is told to reply with JSON only."
        >
          <AppFormField
            label="Output JSON Schema"
            optional
            error={form.formState.errors.outputSchemaText?.message}
            description={`${outputSchemaText.length.toLocaleString()} / ${OUTPUT_SCHEMA_MAX_LENGTH.toLocaleString()} characters · leave empty for free-text replies`}
            labelAction={
              editable ? (
                <AppButton
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => form.setValue("outputSchemaText", EXAMPLE_SCHEMA_TEXT, { shouldDirty: true, shouldValidate: true })}
                >
                  Insert example
                </AppButton>
              ) : null
            }
          >
            {(field) => (
              <AppTextarea {...field} {...form.register("outputSchemaText")} rows={14} spellCheck={false} className="font-mono text-xs leading-5" />
            )}
          </AppFormField>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-foreground-muted">
              Example: this schema makes the agent answer with a summary, next steps and a confidence score.
            </p>
            <AppCodeBlock code={EXAMPLE_SCHEMA_TEXT} label="Example schema" language="json" />
          </div>
        </AppFormSection>

        <AppFormSection
          title="Human approval"
          description="Approval is the safety valve for agents that can act. It applies to the whole agent and overrides the per-tool setting."
        >
          <AppSwitch
            id="agent-requires-approval"
            checked={requiresApproval}
            onCheckedChange={(checked) => form.setValue("requiresApproval", checked, { shouldDirty: true })}
            disabled={!editable}
            label="Require approval for every tool call"
            description="Recommended while you are still learning how the agent behaves."
          />
          <AppAlert tone={requiresApproval ? "warning" : "info"} title="What happens when approval is pending">
            <ul className="mt-1 list-disc pl-4 leading-5">
              <li>The agent’s tool request is recorded on the conversation with the status “approval required”.</li>
              <li>Nothing is executed: no HTTP call, no CRM write, no workflow run, no email.</li>
              <li>The agent continues its reply, tells the person what it wants to do, and waits.</li>
              <li>A member reviews the pending request and either approves it or answers the agent directly.</li>
            </ul>
          </AppAlert>
        </AppFormSection>

        {editable ? (
          <div className="flex flex-col gap-4 pt-2">
            <AppFormActions>
              <AppButton
                type="button"
                variant="secondary"
                onClick={() => form.reset(toFormValues(agent))}
                disabled={!form.formState.isDirty || update.isPending}
              >
                Discard
              </AppButton>
              <AppButton type="submit" loading={update.isPending} disabled={!form.formState.isDirty} leadingIcon={<Braces aria-hidden />}>
                Save settings
              </AppButton>
            </AppFormActions>
            {requiresApproval ? (
              <p className="flex items-center justify-end gap-1.5 text-xs text-foreground-muted">
                <ShieldCheck aria-hidden className="size-3.5" />
                Every tool call will pause for a person.
              </p>
            ) : null}
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}

export function AgentMemoryOutputForm({ agentId }: { agentId: string }) {
  const query = useAgentQuery(agentId);
  if (query.isPending) return <AppSkeleton className="h-96" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <MemoryOutputForm key={query.data.id} agent={query.data} />;
}
