import { updateProfileSchema } from "@/features/settings/schemas";
import { getUserProfile, settingsActor, updateProfile } from "@/features/settings/server/settings-service";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

export const GET = workspaceRoute(async (ctx) => ok(await getUserProfile(settingsActor(ctx))));

/**
 * Updates the caller's own profile, so the floor stays at `viewer`: a viewer
 * is read-only in the *workspace*, not in their own account. The subject is
 * always the session's user id - nothing in the body selects a user.
 */
export const PATCH = workspaceRoute(async (ctx) => {
  const input = await parseJsonBody(ctx.request, updateProfileSchema);
  return ok(await updateProfile(settingsActor(ctx), input));
});
