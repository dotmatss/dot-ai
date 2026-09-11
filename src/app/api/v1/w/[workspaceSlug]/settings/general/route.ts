import { updateWorkspaceNameSchema } from "@/features/settings/schemas";
import {
  getWorkspaceGeneralSettings,
  renameWorkspace,
  settingsActor,
} from "@/features/settings/server/settings-service";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

export const GET = workspaceRoute(async (ctx) => ok(getWorkspaceGeneralSettings(ctx)));

/**
 * Renaming is an administrative change to the whole workspace, so the route
 * floor is `admin`; the service re-checks `canManage` against the role the
 * membership lookup resolved.
 */
export const PATCH = workspaceRoute(
  async (ctx) => {
    const input = await parseJsonBody(ctx.request, updateWorkspaceNameSchema);
    return ok(await renameWorkspace(settingsActor(ctx), input));
  },
  { minimumRole: "admin" },
);
