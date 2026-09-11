import { contactSubListQuerySchema } from "@/features/crm/schemas";
import { getContactConversations } from "@/features/crm/server/contact-service";
import { parseSearchParams } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; contactId: string };

export const GET = workspaceRoute<Params>(async ({ request, membership, params }) => {
  const page = parseSearchParams(request, contactSubListQuerySchema);
  const conversations = await getContactConversations(membership.workspace.id, params.contactId, page);
  return ok(conversations);
});
