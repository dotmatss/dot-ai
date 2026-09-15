import { assignPlanSchema } from "@/features/billing/schemas";
import { assignPlan, billingActor, clearPlan, getBillingOverview } from "@/features/billing/server/billing-service";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/**
 * Reading the plan is an administrative view of the whole workspace, so the
 * floor is `admin` rather than `viewer`: it exposes what the organization is
 * paying for and what it is allowed, which is not part of a viewer's job.
 */
export const GET = workspaceRoute(async (ctx) => ok(await getBillingOverview(ctx.membership.workspace.id)), {
  minimumRole: "admin",
});

/**
 * Assigning a plan is owner-only at the route, and the service re-checks the
 * resolved role. PUT rather than POST because there is at most one subscription
 * per workspace: sending it twice leaves the same single row.
 */
export const PUT = workspaceRoute(
  async (ctx) => {
    const input = await parseJsonBody(ctx.request, assignPlanSchema);
    return ok(await assignPlan(billingActor(ctx), input));
  },
  { minimumRole: "owner" },
);

export const DELETE = workspaceRoute(async (ctx) => ok(await clearPlan(billingActor(ctx))), {
  minimumRole: "owner",
});
