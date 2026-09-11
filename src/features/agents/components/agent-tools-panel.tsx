"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { useForm, useWatch, type Control, type UseFormRegister, type UseFormSetValue } from "react-hook-form";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppFormActions, AppFormField } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppCard } from "@/components/ui/app-card";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppSwitch } from "@/components/ui/app-switch";
import { useUpdateAgentMutation } from "@/features/agents/mutations";
import { useAgentQuery } from "@/features/agents/queries";
import { agentToolsFormSchema, type AgentToolsFormValues } from "@/features/agents/schemas";
import {
  AGENT_TOOL_CATEGORY_LABELS,
  AGENT_TOOL_LIST,
  AGENT_TOOLS,
  toolSettingsForForm,
  type AgentToolConfigField,
  type AgentToolDefinition,
} from "@/features/agents/tools/registry";
import type { Agent } from "@/features/agents/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

function toFormValues(agent: Agent): AgentToolsFormValues {
  return {
    tools: toolSettingsForForm(agent.tools).map((setting) => ({
      toolId: setting.toolId,
      enabled: setting.enabled,
      requiresApproval: setting.requiresApproval,
      config: Object.fromEntries(
        AGENT_TOOLS[setting.toolId].configFields.map((field) => {
          const value = setting.config[field.key];
          const fallback = AGENT_TOOLS[setting.toolId].defaultConfig[field.key];
          const resolved = value === undefined ? fallback : value;
          return [field.key, typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean" ? resolved : ""];
        }),
      ),
    })),
  };
}

interface ToolRowProps {
  definition: AgentToolDefinition;
  index: number;
  control: Control<AgentToolsFormValues>;
  register: UseFormRegister<AgentToolsFormValues>;
  setValue: UseFormSetValue<AgentToolsFormValues>;
  configErrors: Record<string, { message?: string } | undefined> | undefined;
  agentRequiresApproval: boolean;
  editable: boolean;
}

function ConfigInput({
  field,
  index,
  control,
  register,
  setValue,
  editable,
}: {
  field: AgentToolConfigField;
  index: number;
  control: Control<AgentToolsFormValues>;
  register: UseFormRegister<AgentToolsFormValues>;
  setValue: UseFormSetValue<AgentToolsFormValues>;
  editable: boolean;
}) {
  const path = `tools.${index}.config.${field.key}` as const;
  const value = useWatch({ control, name: path });

  if (field.kind === "switch") {
    return (
      <AppSwitch
        id={path}
        checked={value === true}
        onCheckedChange={(checked) => setValue(path, checked, { shouldDirty: true })}
        disabled={!editable}
        label={field.label}
        description={field.description}
      />
    );
  }

  return (
    <AppFormField label={field.label} description={field.description}>
      {(fieldProps) =>
        field.kind === "select" ? (
          <AppSelect {...fieldProps} {...register(path)} options={field.options ?? []} />
        ) : field.kind === "number" ? (
          <AppInput
            {...fieldProps}
            {...register(path, { valueAsNumber: true })}
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            inputMode="numeric"
          />
        ) : (
          <AppInput {...fieldProps} {...register(path)} placeholder={field.placeholder} />
        )
      }
    </AppFormField>
  );
}

function ToolRow({ definition, index, control, register, setValue, configErrors, agentRequiresApproval, editable }: ToolRowProps) {
  const Icon = definition.icon;
  const enabled = useWatch({ control, name: `tools.${index}.enabled` });
  const requiresApproval = useWatch({ control, name: `tools.${index}.requiresApproval` });
  const enabledId = `tool-${definition.id}-enabled`;
  const approvalId = `tool-${definition.id}-approval`;

  return (
    <AppCard padding="md" className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
          <Icon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={enabledId} className="text-sm font-semibold">
              {definition.name}
            </label>
            <AppBadge size="sm">{AGENT_TOOL_CATEGORY_LABELS[definition.category]}</AppBadge>
            {definition.requiresApprovalByDefault ? (
              <AppBadge size="sm" tone="warning" icon={<ShieldCheck aria-hidden />}>
                Approval by default
              </AppBadge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-foreground-muted">{definition.description}</p>
          <p className="mt-1 text-xs text-foreground-subtle">{definition.capability}</p>
        </div>
        <AppSwitch
          id={enabledId}
          checked={enabled}
          onCheckedChange={(checked) => setValue(`tools.${index}.enabled`, checked, { shouldDirty: true })}
          disabled={!editable}
          aria-label={`Enable ${definition.name}`}
        />
      </div>

      {enabled ? (
        <div className="flex flex-col gap-5 border-t border-border pt-4">
          <div className="grid gap-5 sm:grid-cols-2">
            {definition.configFields.map((field) => {
              const message = configErrors?.[field.key]?.message;
              return (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <ConfigInput field={field} index={index} control={control} register={register} setValue={setValue} editable={editable} />
                  {message ? (
                    <p className="text-xs text-danger" role="alert">
                      {message}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
            <AppSwitch
              id={approvalId}
              checked={agentRequiresApproval || requiresApproval}
              onCheckedChange={(checked) => setValue(`tools.${index}.requiresApproval`, checked, { shouldDirty: true })}
              disabled={!editable || agentRequiresApproval}
              label="Requires human approval"
              description={
                agentRequiresApproval
                  ? "Forced on: this agent requires approval for every tool call."
                  : "The agent asks for this tool, the request is recorded, and nothing runs until a person approves it."
              }
            />
          </div>
        </div>
      ) : null}
    </AppCard>
  );
}

function ToolsForm({ agent }: { agent: Agent }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const update = useUpdateAgentMutation(agent.id);
  const form = useForm<AgentToolsFormValues>({
    resolver: zodResolver(agentToolsFormSchema),
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
        tools: values.tools.map((row) => ({
          toolId: row.toolId,
          enabled: row.enabled,
          requiresApproval: row.requiresApproval,
          config: row.config,
        })),
      },
      {
        onSuccess: (updated) => form.reset(toFormValues(updated)),
        onError: (error) => {
          if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
        },
      },
    );
  });

  const rootError = form.formState.errors.tools?.message ?? form.formState.errors.root?.message;

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-3">
      <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-4 lg:col-span-2">
        <legend className="sr-only">Tools</legend>
        {AGENT_TOOL_LIST.map((definition, index) => (
          <ToolRow
            key={definition.id}
            definition={definition}
            index={index}
            control={form.control}
            register={form.register}
            setValue={form.setValue}
            configErrors={form.formState.errors.tools?.[index]?.config as Record<string, { message?: string } | undefined> | undefined}
            agentRequiresApproval={agent.requiresApproval}
            editable={editable}
          />
        ))}
        {rootError ? (
          <AppAlert tone="danger" title="Tools could not be saved">
            {rootError}
          </AppAlert>
        ) : null}
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
              Save tools
            </AppButton>
          </AppFormActions>
        ) : null}
      </fieldset>

      <aside className="flex flex-col gap-4">
        <AppAlert tone="info" title="How approval works">
          Agents in this platform request tools; they never run them on their own. A request is recorded on the conversation with one of three
          outcomes: <strong>simulated</strong> when the tool is enabled and needs no approval, <strong>approval required</strong> when the tool or the
          agent asks for a human, and <strong>unknown tool</strong> when the model invents a tool that does not exist.
        </AppAlert>
        <AppCard padding="md" className="flex flex-col gap-2 text-sm">
          <p className="font-semibold">Choosing tools</p>
          <p className="text-foreground-muted">
            Enable only what the task needs. Every enabled tool is described in the system prompt, so a long list makes the agent slower and less
            predictable.
          </p>
          <p className="text-foreground-muted">
            Tools that write outside this workspace — HTTP requests, workflow runs, email — default to requiring approval. Keep it that way until you
            trust the agent’s judgement.
          </p>
        </AppCard>
      </aside>
    </form>
  );
}

export function AgentToolsPanel({ agentId }: { agentId: string }) {
  const query = useAgentQuery(agentId);
  if (query.isPending) return <AppSkeleton className="h-96" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <ToolsForm key={query.data.id} agent={query.data} />;
}
