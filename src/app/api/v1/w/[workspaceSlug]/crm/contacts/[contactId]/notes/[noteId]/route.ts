import { contactActor, deleteContactNote } from "@/features/crm/server/contact-service";
import { noContent } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; contactId: string; noteId: string };

/**
 * Members may delete their own notes; the service re-checks authorship and
 * lets admins delete any, which is why the route floor is "member" rather
 * than "admin".
 */
export const DELETE = workspaceRoute<Params>(
  async (ctx) => {
    await deleteContactNote(contactActor(ctx), ctx.params.contactId, ctx.params.noteId);
    return noContent();
  },
  { minimumRole: "member" },
);
