import type { AssignPlanInput } from "@/features/billing/schemas";
import type { BillingOverview } from "@/features/billing/types";
import { apiFetch } from "@/lib/api/http";

const base = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/settings/billing`;

/**
 * Client-side API surface for billing. The workspace is resolved on the server
 * from the slug in the path, so nothing here carries a workspace id.
 */
export const billingApi = {
  overview: (workspaceSlug: string) => apiFetch<BillingOverview>(base(workspaceSlug)),
  assignPlan: (workspaceSlug: string, input: AssignPlanInput) =>
    apiFetch<BillingOverview>(base(workspaceSlug), { method: "PUT", json: input }),
  clearPlan: (workspaceSlug: string) => apiFetch<BillingOverview>(base(workspaceSlug), { method: "DELETE" }),
};
