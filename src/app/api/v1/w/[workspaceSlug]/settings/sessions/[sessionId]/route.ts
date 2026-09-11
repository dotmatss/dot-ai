import { revokeUserSession, settingsActor } from "@/features/settings/server/settings-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; sessionId: string };

/**
 * Signs one device out.
 *
 * The id is a path segment, so it is untrusted: the service only accepts it
 * after proving the row belongs to the caller. A session id belonging to
 * someone else resolves to 404, which is also what a made-up one gets, so the
 * endpoint does not confirm that a session exists.
 */
export const DELETE = workspaceRoute<Params>(async (ctx) =>
  ok(await revokeUserSession(settingsActor(ctx), ctx.params.sessionId)),
);
