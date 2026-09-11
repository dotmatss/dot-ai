import { updateContactSchema } from "@/features/crm/schemas";
import { contactActor, deleteContact, getContact, updateContact } from "@/features/crm/server/contact-service";
import { parseJsonBody } from "@/server/http/request";
import { noContent, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; contactId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  const contact = await getContact(membership.workspace.id, params.contactId);
  return ok(contact);
});

export const PATCH = workspaceRoute<Params>(
  async (ctx) => {
    const input = await parseJsonBody(ctx.request, updateContactSchema);
    const contact = await updateContact(contactActor(ctx), ctx.params.contactId, input);
    return ok(contact);
  },
  { minimumRole: "member" },
);

/** Deleting a contact removes its notes and activity history by cascade. */
export const DELETE = workspaceRoute<Params>(
  async (ctx) => {
    await deleteContact(contactActor(ctx), ctx.params.contactId);
    return noContent();
  },
  { minimumRole: "admin" },
);
