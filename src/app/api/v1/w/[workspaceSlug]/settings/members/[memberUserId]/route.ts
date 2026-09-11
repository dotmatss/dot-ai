import { updateMemberRoleSchema } from "@/features/settings/schemas";
import { changeMemberRole, removeMember, settingsActor } from "@/features/settings/server/settings-service";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; memberUserId: string };

/**
 * Membership writes.
 *
 * The route floor is `admin`, which matches `canManage`. That is the outer
 * gate, not the decision: the service evaluates `member-rules` against rows it
 * reads inside the transaction - only an owner may touch an owner or hand out
 * `owner`, and the organization must keep one - and a refusal leaves here as a
 * 403 carrying the rule's own explanation.
 *
 * `memberUserId` names the subject of the change. It is never the subject of
 * the *authorization*: that is the session, resolved by `workspaceRoute`.
 */
export const PATCH = workspaceRoute<Params>(
  async (ctx) => {
    const input = await parseJsonBody(ctx.request, updateMemberRoleSchema);
    return ok(await changeMemberRole(settingsActor(ctx), ctx.params.memberUserId, input.role));
  },
  { minimumRole: "admin" },
);

export const DELETE = workspaceRoute<Params>(
  async (ctx) => ok(await removeMember(settingsActor(ctx), ctx.params.memberUserId)),
  { minimumRole: "admin" },
);
