import { getMembersOverview, settingsActor } from "@/features/settings/server/settings-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/**
 * The members of the organization this workspace belongs to. Any member of the
 * workspace may see who else is in it; only admins and owners may change it.
 */
export const GET = workspaceRoute(async (ctx) => ok(await getMembersOverview(settingsActor(ctx))));
