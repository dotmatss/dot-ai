"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppFormActions, AppFormField, AppFormSection } from "@/components/forms/form-field";
import { AppButton } from "@/components/ui/app-button";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppTextarea } from "@/components/ui/app-textarea";
import { DEFAULT_INSTRUCTIONS_PLACEHOLDER, INSTRUCTIONS_MAX_LENGTH, MODEL_OPTIONS } from "@/features/agents/constants";
import { useUpdateAgentMutation } from "@/features/agents/mutations";
import { useAgentQuery } from "@/features/agents/queries";
import { agentInstructionsFormSchema, type AgentInstructionsFormValues } from "@/features/agents/schemas";
import type { Agent } from "@/features/agents/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

function toFormValues(agent: Agent): AgentInstructionsFormValues {
  return {
    instructions: agent.instructions,
    model: agent.modelConfig.model ?? "",
    temperature: agent.modelConfig.temperature,
    maxTokens: agent.modelConfig.maxTokens,
  };
}

function InstructionsForm({ agent }: { agent: Agent }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const update = useUpdateAgentMutation(agent.id);
  const form = useForm<AgentInstructionsFormValues>({
    resolver: zodResolver(agentInstructionsFormSchema),
    defaultValues: toFormValues(agent),
  });

  // Keyed on the record id rather than its updatedAt: remounting whenever any
  // sibling mutation touches the record (a status toggle in the header, say)
  // would throw away whatever the user is typing. Reconcile instead, and only
  // when there is nothing to lose.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(toFormValues(agent));
  }, [agent, form]);

  const onSubmit = form.handleSubmit((values) => {
    update.mutate(
      {
        instructions: values.instructions,
        modelConfig: { model: values.model || null, temperature: values.temperature, maxTokens: values.maxTokens },
      },
      {
        onSuccess: (updated) => form.reset(toFormValues(updated)),
        onError: (error) => {
          if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
        },
      },
    );
  });

  const instructionsLength = useWatch({ control: form.control, name: "instructions" }).length;

  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset disabled={!editable} className="min-w-0">
        <AppFormSection
          title="Instructions"
          description="The agent's standing orders: its role, how it should work through a task, when to use tools and when to hand back to a person. Sent as the system prompt on every run."
        >
          <AppFormField
            label="Instructions"
            error={form.formState.errors.instructions?.message}
            description={`${instructionsLength.toLocaleString()} / ${INSTRUCTIONS_MAX_LENGTH.toLocaleString()} characters`}
          >
            {(field) => (
              <AppTextarea
                {...field}
                {...form.register("instructions")}
                rows={16}
                placeholder={DEFAULT_INSTRUCTIONS_PLACEHOLDER}
                className="font-mono text-xs leading-5"
              />
            )}
          </AppFormField>
        </AppFormSection>

        <AppFormSection title="Model" description="Model routing happens in the AI gateway, so these settings stay portable across providers.">
          <AppFormField label="Model" error={form.formState.errors.model?.message}>
            {(field) => <AppSelect {...field} {...form.register("model")} options={MODEL_OPTIONS} />}
          </AppFormField>
          <div className="grid gap-5 sm:grid-cols-2">
            <AppFormField
              label="Temperature"
              description="0 is focused and repeatable, 2 is exploratory. Agents that call tools usually want a low value."
              error={form.formState.errors.temperature?.message}
            >
              {(field) => (
                <AppInput
                  {...field}
                  {...form.register("temperature", { valueAsNumber: true })}
                  type="number"
                  step="0.1"
                  min={0}
                  max={2}
                  inputMode="decimal"
                />
              )}
            </AppFormField>
            <AppFormField label="Max response tokens" description="Upper bound for each reply." error={form.formState.errors.maxTokens?.message}>
              {(field) => (
                <AppInput
                  {...field}
                  {...form.register("maxTokens", { valueAsNumber: true })}
                  type="number"
                  step="64"
                  min={64}
                  max={8192}
                  inputMode="numeric"
                />
              )}
            </AppFormField>
          </div>
          {editable ? (
            <AppFormActions>
              <AppButton
                type="button"
                variant="secondary"
                onClick={() => form.reset(toFormValues(agent))}
                disabled={!form.formState.isDirty || update.isPending}
              >
                Discard
              </AppButton>
              <AppButton type="submit" loading={update.isPending} disabled={!form.formState.isDirty}>
                Save changes
              </AppButton>
            </AppFormActions>
          ) : null}
        </AppFormSection>
      </fieldset>
    </form>
  );
}

export function AgentInstructionsForm({ agentId }: { agentId: string }) {
  const query = useAgentQuery(agentId);
  if (query.isPending) return <AppSkeleton className="h-96" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <InstructionsForm key={query.data.id} agent={query.data} />;
}
