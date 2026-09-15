import { inviteMemberSchema } from "@/features/settings/schemas";
import { inviteMember, settingsActor } from "@/features/settings/server/settings-service";
import { parseJsonBody } from "@/server/http/request";
import { created } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/**
 * Creating an invitation.
 *
 * The route floor is `admin`; which roles may be handed out is decided by
 * `canInviteMember` against the actor's freshly read row, so an admin cannot
 * mint an owner even though both pass this gate.
 *
 * The response carries the invite URL, and it is the only time it ever will:
 * the database holds the token's hash, so a later read cannot reproduce it.
 * There is no GET here for the same reason the members list has none of its
 * own - `getMembersOverview` already returns the open invitations alongside the
 * people, and one payload keeps the two from disagreeing.
 */
export const POST = workspaceRoute(
  async (ctx) => {
    const input = await parseJsonBody(ctx.request, inviteMemberSchema);
    return created(await inviteMember(settingsActor(ctx), input));
  },
  { minimumRole: "admin" },
);
