"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Play } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton, type ButtonVariant } from "@/components/ui/app-button";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppInput } from "@/components/ui/app-input";
import { AppText } from "@/components/ui/app-typography";
import type { WorkflowDefinition } from "@/features/workflows/domain/definition";
import { formInputConfigSchema, manualTriggerConfigSchema } from "@/features/workflows/domain/node-types";
import { useStartWorkflowRunMutation } from "@/features/workflows/mutations";
import { runInputSchema } from "@/features/workflows/schemas";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

const FORM_ID = "run-workflow-form";

type RunValues = Record<string, string>;

/** Fields an `input.form` step requires, so the dialog asks for exactly those. */
function requiredInputFields(definition: WorkflowDefinition): string[] {
  const fields = new Set<string>();
  for (const node of definition.nodes) {
    if (node.type !== "input.form") continue;
    const parsed = formInputConfigSchema.safeParse(node.config);
    if (parsed.success) for (const field of parsed.data.fields) fields.add(field);
  }
  return [...fields];
}

function operatorNote(definition: WorkflowDefinition): string | null {
  const trigger = definition.nodes.find((node) => node.type === "trigger.manual");
  if (!trigger) return null;
  const parsed = manualTriggerConfigSchema.safeParse(trigger.config);
  const note = parsed.success ? parsed.data.note.trim() : "";
  return note.length > 0 ? note : null;
}

function RunForm({
  definition,
  onStarted,
  mutation,
}: {
  definition: WorkflowDefinition;
  onStarted: (runId: string) => void;
  mutation: ReturnType<typeof useStartWorkflowRunMutation>;
}) {
  const fields = useMemo(() => requiredInputFields(definition), [definition]);
  const resolver = useMemo(() => zodResolver(runInputSchema(fields)) as Resolver<RunValues>, [fields]);
  const form = useForm<RunValues>({
    resolver,
    defaultValues: Object.fromEntries(fields.map((field) => [field, ""])),
  });
  const note = operatorNote(definition);

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(
      { input: values },
      {
        onSuccess: (run) => onStarted(run.id),
        onError: (error) => {
          if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
        },
      },
    );
  });

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {note ? <AppAlert tone="info" title="About this workflow">{note}</AppAlert> : null}
      {fields.length === 0 ? (
        <AppText size="sm" tone="muted">
          This workflow does not collect any input. Starting a run executes every step in order and records the result.
        </AppText>
      ) : (
        fields.map((field) => (
          <AppFormField key={field} label={field} required error={form.formState.errors[field]?.message}>
            {(control) => <AppInput {...control} {...form.register(field)} placeholder={`Value for ${field}`} />}
          </AppFormField>
        ))
      )}
    </form>
  );
}

export function RunWorkflowButton({
  workflowId,
  definition,
  variant = "secondary",
  label = "Run",
}: {
  workflowId: string;
  definition: WorkflowDefinition;
  variant?: ButtonVariant;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { membership } = useWorkspace();
  const mutation = useStartWorkflowRunMutation(workflowId);
  if (!canEdit(membership.role)) return null;

  return (
    <>
      <AppButton variant={variant} onClick={() => setOpen(true)} leadingIcon={<Play aria-hidden />}>
        {label}
      </AppButton>
      <AppDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Start a run"
        description="The run executes immediately and appears in the Runs tab with a step-by-step timeline."
        dismissible={!mutation.isPending}
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancel
            </AppButton>
            <AppButton type="submit" form={FORM_ID} loading={mutation.isPending} leadingIcon={<Play aria-hidden />}>
              Start run
            </AppButton>
          </>
        }
      >
        {open ? (
          <RunForm
            definition={definition}
            mutation={mutation}
            onStarted={(runId) => {
              setOpen(false);
              router.push(`/w/${membership.workspace.slug}/workflows/${workflowId}/runs/${runId}` as Route);
            }}
          />
        ) : null}
      </AppDialog>
    </>
  );
}
