"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";

import { AppFormActions, AppFormField, AppFormSection } from "@/components/forms/form-field";
import { AppButton } from "@/components/ui/app-button";
import { AppCheckbox } from "@/components/ui/app-checkbox";
import { AppSelect } from "@/components/ui/app-select";
import { AppText } from "@/components/ui/app-typography";
import { SUBSCRIPTION_STATUS_META } from "@/features/billing/constants";
import { useAssignPlanMutation, useClearPlanMutation } from "@/features/billing/mutations";
import { planAssignmentFormSchema, type PlanAssignmentFormValues } from "@/features/billing/schemas";
import { SUBSCRIPTION_STATUSES, type BillingOverview } from "@/features/billing/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { hasMinimumRole } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

function toFormValues(overview: BillingOverview): PlanAssignmentFormValues {
  return {
    planId: overview.subscription?.planId ?? "",
    status: overview.subscription?.status ?? "active",
    cancelAtPeriodEnd: overview.subscription?.cancelAtPeriodEnd ?? false,
  };
}

/**
 * Assigning a plan.
 *
 * Owner-only, matching the promise in `MEMBER_ROLE_DESCRIPTIONS` that an owner
 * has "full access, including billing". The gate here is cosmetic - the route
 * floor is `owner` and the service re-checks the resolved role - but a control
 * that always 403s is worse than no control.
 */
export function PlanAssignmentForm({ overview }: { overview: BillingOverview }) {
  const { membership } = useWorkspace();
  const canAssign = hasMinimumRole(membership.role, "owner");
  const assign = useAssignPlanMutation();
  const clear = useClearPlanMutation();

  const form = useForm<PlanAssignmentFormValues>({
    resolver: zodResolver(planAssignmentFormSchema),
    defaultValues: toFormValues(overview),
  });

  // Reconcile rather than remount, so a half-made choice survives a sibling
  // mutation refreshing the overview.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(toFormValues(overview));
  }, [overview, form]);

  const status = useWatch({ control: form.control, name: "status" });

  const onSubmit = form.handleSubmit((values) => {
    assign.mutate(values, {
      onSuccess: () => form.reset(form.getValues()),
      onError: (error) => {
        if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
      },
    });
  });

  if (!canAssign) {
    return (
      <AppFormSection title="Change plan" description="Which plan this workspace is on.">
        <AppText size="sm" tone="muted">
          Only an owner can change this workspace&apos;s plan.
        </AppText>
      </AppFormSection>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <AppFormSection
        title="Change plan"
        description="Assigning a plan starts enforcing whichever of its limits have actually been decided. Nothing is charged."
      >
        <AppFormField label="Plan" required error={form.formState.errors.planId?.message}>
          {(field) => (
            <AppSelect
              {...field}
              {...form.register("planId")}
              placeholder="Choose a plan"
              options={overview.assignablePlans.map((plan) => ({
                value: plan.id,
                label: plan.isDraft ? `${plan.name} (draft)` : plan.name,
              }))}
            />
          )}
        </AppFormField>

        <AppFormField
          label="Status"
          error={form.formState.errors.status?.message}
          description={SUBSCRIPTION_STATUS_META[status]?.description}
        >
          {(field) => (
            <AppSelect
              {...field}
              {...form.register("status")}
              options={SUBSCRIPTION_STATUSES.map((value) => ({
                value,
                label: SUBSCRIPTION_STATUS_META[value].label,
              }))}
            />
          )}
        </AppFormField>

        {/*
          Outside AppFormField: AppCheckbox names itself through its own `label`,
          and wrapping it would give the control two labels.
        */}
        <AppCheckbox
          {...form.register("cancelAtPeriodEnd")}
          label="End at period end"
          description="Stop this plan when the current period ends. Nothing expires it automatically yet - this records the intent."
        />

        <AppFormActions>
          <AppButton type="submit" loading={assign.isPending}>
            {overview.subscription ? "Update plan" : "Assign plan"}
          </AppButton>
          {overview.subscription ? (
            <AppButton type="button" variant="ghost" loading={clear.isPending} onClick={() => clear.mutate()}>
              Remove plan
            </AppButton>
          ) : null}
        </AppFormActions>
      </AppFormSection>
    </form>
  );
}
