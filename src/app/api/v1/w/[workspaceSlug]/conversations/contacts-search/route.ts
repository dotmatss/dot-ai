import { contactSearchQuerySchema } from "@/features/conversations/schemas";
import { searchLinkableContacts } from "@/features/conversations/server/conversation-service";
import { parseSearchParams } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/**
 * Contact type-ahead for linking a conversation to a person. It lives in this
 * feature because the inbox needs it before the CRM ships its own endpoint; it
 * returns only the fields the picker renders, never the full contact record.
 */
export const GET = workspaceRoute(async ({ request, membership }) => {
  const { q, limit } = parseSearchParams(request, contactSearchQuerySchema);
  const contacts = await searchLinkableContacts(membership.workspace.id, q, limit);
  return ok(contacts);
});
