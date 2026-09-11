import { z } from "zod";

import {
  getUserSessions,
  revokeAllUserSessions,
  revokeOtherUserSessions,
  settingsActor,
} from "@/features/settings/server/settings-service";
import { parseSearchParams } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/**
 * The caller's own sessions. There is no role gate beyond workspace access:
 * these rows belong to the person asking, not to the workspace, and the
 * service filters every query by the session's user id.
 */
export const GET = workspaceRoute(async (ctx) => ok(await getUserSessions(settingsActor(ctx))));

const revokeScopeSchema = z.object({
  scope: z.enum(["others", "all"]).default("others"),
});

/** Bulk sign-out: every other device, or every device including this one. */
export const DELETE = workspaceRoute(async (ctx) => {
  const { scope } = parseSearchParams(ctx.request, revokeScopeSchema);
  const actor = settingsActor(ctx);
  return ok(scope === "all" ? await revokeAllUserSessions(actor) : await revokeOtherUserSessions(actor));
});
