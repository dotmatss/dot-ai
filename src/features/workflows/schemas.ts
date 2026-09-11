import { z } from "zod";

import { RUN_INPUT_MAX_CHARS, WORKFLOW_DESCRIPTION_MAX, WORKFLOW_NAME_MAX } from "@/features/workflows/constants";
import { workflowDefinitionSchema } from "@/features/workflows/domain/definition";
import { WORKFLOW_TEMPLATE_IDS } from "@/features/workflows/domain/templates";
import { WORKFLOW_RUN_STATUSES, WORKFLOW_STATUSES } from "@/features/workflows/types";

export const workflowStatusSchema = z.enum(WORKFLOW_STATUSES);
export const workflowRunStatusSchema = z.enum(WORKFLOW_RUN_STATUSES);

const nameSchema = z
  .string()
  .trim()
  .min(2, { error: "Enter a name" })
  .max(WORKFLOW_NAME_MAX, { error: `Keep the name under ${WORKFLOW_NAME_MAX} characters` });

const descriptionSchema = z
  .string()
  .trim()
  .max(WORKFLOW_DESCRIPTION_MAX, { error: `Keep the description under ${WORKFLOW_DESCRIPTION_MAX} characters` });

export const createWorkflowSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  template: z.enum(WORKFLOW_TEMPLATE_IDS).default("blank"),
});

export type CreateWorkflowInput = z.input<typeof createWorkflowSchema>;
export type CreateWorkflowValues = z.output<typeof createWorkflowSchema>;

export const updateWorkflowSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.nullable(),
    status: workflowStatusSchema,
    definition: workflowDefinitionSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: "Nothing to update" });

export type UpdateWorkflowInput = z.input<typeof updateWorkflowSchema>;

export const workflowListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  status: workflowStatusSchema.optional(),
});

export const workflowRunListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: workflowRunStatusSchema.optional(),
});

export const startWorkflowRunSchema = z
  .object({
    input: z.record(z.string().max(80), z.unknown()).default({}),
    note: z.string().trim().max(200).optional(),
  })
  .refine((value) => JSON.stringify(value.input ?? {}).length <= RUN_INPUT_MAX_CHARS, {
    error: "The run input is too large",
    path: ["input"],
  });

export type StartWorkflowRunInput = z.input<typeof startWorkflowRunSchema>;

export const workflowSettingsFormSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
});

export type WorkflowSettingsFormValues = z.output<typeof workflowSettingsFormSchema>;

/**
 * Schema for the "start a run" dialog, built from the fields an `input.form`
 * step declares so the dialog validates exactly what the run requires.
 */
export function runInputSchema(fields: ReadonlyArray<string>) {
  return z.object(
    Object.fromEntries(
      fields.map((field) => [field, z.string().trim().min(1, { error: "Enter a value" }).max(2000)] as const),
    ),
  );
}
