import { contactListQuerySchema, createContactSchema } from "@/features/crm/schemas";
import { contactActor, createContact, getContacts } from "@/features/crm/server/contact-service";
import { parseJsonBody, parseSearchParams } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

export const GET = workspaceRoute(async ({ request, membership }) => {
  const filters = parseSearchParams(request, contactListQuerySchema);
  const page = await getContacts(membership.workspace.id, filters);
  return ok(page);
});

export const POST = workspaceRoute(
  async (ctx) => {
    const input = await parseJsonBody(ctx.request, createContactSchema);
    const contact = await createContact(contactActor(ctx), input);
    return created(contact);
  },
  { minimumRole: "member" },
);
