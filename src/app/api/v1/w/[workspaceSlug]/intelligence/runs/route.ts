import { runAnalysisSchema } from "@/features/intelligence/schemas";
import { getAnalysisRuns, intelligenceActor, startAnalysis } from "@/features/intelligence/server/intelligence-service";
import { ApiError } from "@/lib/api/api-error";
import { checkRateLimit } from "@/server/http/rate-limit";
import { parseJsonBody } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

export const GET = workspaceRoute(async ({ membership }) => {
  const runs = await getAnalysisRuns(membership.workspace.id);
  return ok(runs);
});

/**
 * Starts an analysis and waits for it to finish.
 *
 * Rate limited on top of the one-run-per-workspace index: the index stops two
 * runs overlapping, but nothing in it stops somebody starting a fresh run the
 * instant the last one returns, and each run embeds up to two thousand
 * conversations and makes up to twenty-five model calls.
 */
export const POST = workspaceRoute(
  async (ctx) => {
    const limit = checkRateLimit(`intelligence:run:${ctx.membership.workspace.id}`, {
      limit: 6,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.allowed) {
      throw ApiError.rateLimited(`Analyses are limited to six an hour. Try again in ${limit.retryAfterSeconds}s.`);
    }

    const input = await parseJsonBody(ctx.request, runAnalysisSchema);
    const run = await startAnalysis(intelligenceActor(ctx), input, ctx.request.signal);
    return created(run);
  },
  { minimumRole: "member" },
);
