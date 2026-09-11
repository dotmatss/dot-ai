import { contactSubListQuerySchema, createContactNoteSchema } from "@/features/crm/schemas";
import { addContactNote, contactActor, getContactNotes } from "@/features/crm/server/contact-service";
import { parseJsonBody, parseSearchParams } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; contactId: string };

export const GET = workspaceRoute<Params>(async ({ request, membership, params }) => {
  const page = parseSearchParams(request, contactSubListQuerySchema);
  const notes = await getContactNotes(membership.workspace.id, params.contactId, page);
  return ok(notes);
});

export const POST = workspaceRoute<Params>(
  async (ctx) => {
    const input = await parseJsonBody(ctx.request, createContactNoteSchema);
    const note = await addContactNote(contactActor(ctx), ctx.params.contactId, input.body);
    return created(note);
  },
  { minimumRole: "member" },
);
