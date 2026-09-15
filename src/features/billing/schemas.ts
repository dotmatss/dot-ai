import { z } from "zod";

import { SUBSCRIPTION_STATUSES } from "@/features/billing/types";
import { PLANS } from "@/features/pricing/plans";

/** Shared by the route handler (server) and the plan form (client). */

export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);

/**
 * The plan id is validated against the catalogue rather than accepted as free
 * text. `workspace_subscriptions.plan_id` has no foreign key - the catalogue is
 * a TypeScript file, not a table - so this schema is the thing that stops a
 * typo becoming a workspace that is on a plan nobody can resolve.
 *
 * Built from `PLANS` at module load, so adding a plan needs no edit here.
 */
export const planIdSchema = z
  .string()
  .trim()
  .refine((value) => PLANS.some((plan) => plan.id === value), { error: "Choose a plan from the catalogue" });

export const assignPlanSchema = z.object({
  planId: planIdSchema,
  status: subscriptionStatusSchema.default("active"),
  /**
   * Optional: an assignment with no explicit end gets the default period. A
   * caller that supplies one must supply a future instant, because the metered
   * window is half-open and a period ending in the past would count nothing.
   */
  currentPeriodEnd: z.iso
    .datetime({ error: "Enter a valid date" })
    .optional()
    .refine((value) => value === undefined || new Date(value).getTime() > Date.now(), {
      error: "The period must end in the future",
    }),
  cancelAtPeriodEnd: z.boolean().default(false),
});

export type AssignPlanInput = z.input<typeof assignPlanSchema>;
export type AssignPlanValues = z.output<typeof assignPlanSchema>;

/**
 * The form's own schema.
 *
 * Separate from the wire schema because `.default()` makes a field optional on
 * the way in and required on the way out, which react-hook-form cannot model
 * with a single type - the same reason `workspaceGeneralFormSchema` exists in
 * the settings feature. Here every field is present, because the form always
 * renders a control for it.
 */
export const planAssignmentFormSchema = z.object({
  planId: planIdSchema,
  status: subscriptionStatusSchema,
  cancelAtPeriodEnd: z.boolean(),
});

export type PlanAssignmentFormValues = z.infer<typeof planAssignmentFormSchema>;
