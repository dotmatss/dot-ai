import { contactActor } from "@/features/crm/server/contact-service";
import { generateContactSummary } from "@/features/crm/server/contact-summary";
import { ApiError } from "@/lib/api/api-error";
import { checkRateLimits } from "@/server/http/rate-limit";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; contactId: string };

/**
 * Summarizing costs tokens, so the limits are keyed on server-derived ids
 * (workspace and contact) rather than anything the caller controls: a
 * workspace ceiling stops a scripted loop, and the per-contact one stops a
 * user hammering the button while a summary is already fresh.
 */
export const POST = workspaceRoute<Params>(
  async (ctx) => {
    const workspaceId = ctx.membership.workspace.id;
    const limit = checkRateLimits([
      { key: `crm:summary:workspace:${workspaceId}`, limit: 60, windowMs: 60_000 },
      { key: `crm:summary:contact:${ctx.params.contactId}`, limit: 5, windowMs: 60_000 },
    ]);
    if (!limit.allowed) {
      throw ApiError.rateLimited(`Too many summary requests. Try again in ${limit.retryAfterSeconds} seconds.`);
    }

    const contact = await generateContactSummary(contactActor(ctx), ctx.params.contactId, {
      signal: ctx.request.signal,
    });
    return ok(contact);
  },
  { minimumRole: "member" },
);
