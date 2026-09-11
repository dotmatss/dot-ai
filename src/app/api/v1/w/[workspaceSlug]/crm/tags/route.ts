import { getContactTags } from "@/features/crm/server/contact-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/** Distinct contact tags with counts, used by the list's tag filter. */
export const GET = workspaceRoute(async ({ membership }) => {
  const tags = await getContactTags(membership.workspace.id);
  return ok(tags);
});
