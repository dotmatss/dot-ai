import { startWorkflowRunSchema, workflowRunListQuerySchema } from "@/features/workflows/schemas";
import { startWorkflowRun } from "@/features/workflows/server/executor";
import { getWorkflowRuns } from "@/features/workflows/server/workflow-service";
import { ApiError } from "@/lib/api/api-error";
import { checkRateLimit } from "@/server/http/rate-limit";
import { parseJsonBody, parseSearchParams } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; workflowId: string };

export const GET = workspaceRoute<Params>(async ({ request, membership, params }) => {
  const filters = parseSearchParams(request, workflowRunListQuerySchema);
  const page = await getWorkflowRuns(membership.workspace.id, params.workflowId, filters);
  return ok(page);
});

/**
 * Starts a run and awaits it. Runs are metered and call the AI gateway, so the
 * endpoint is rate limited per member on top of the role check.
 */
export const POST = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const limit = checkRateLimit(`workflow-run:${membership.workspace.id}:${user.id}`, { limit: 20, windowMs: 60_000 });
    if (!limit.allowed) {
      throw ApiError.rateLimited(`Too many runs. Try again in ${limit.retryAfterSeconds}s.`);
    }
    const input = await parseJsonBody(request, startWorkflowRunSchema);
    const run = await startWorkflowRun({
      ctx: { workspaceId: membership.workspace.id, userId: user.id },
      workflowId: params.workflowId,
      input: input.input,
      trigger: { kind: "manual", label: input.note ?? user.name, payload: input.input },
      signal: request.signal,
    });
    return created(run);
  },
  { minimumRole: "member" },
);
