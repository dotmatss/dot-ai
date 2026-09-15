import { revokeInvitation, settingsActor } from "@/features/settings/server/settings-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; invitationId: string };

/**
 * Withdraws a pending invitation.
 *
 * `invitationId` comes from the URL and is never trusted on its own: the update
 * is scoped to the organization the session was authorized for, so an id from
 * another organization matches no row and leaves as a 404.
 */
export const DELETE = workspaceRoute<Params>(
  async (ctx) => ok(await revokeInvitation(settingsActor(ctx), ctx.params.invitationId)),
  { minimumRole: "admin" },
);
