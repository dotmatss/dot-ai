import { getCollectionOptions } from "@/features/knowledge/server/knowledge-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/**
 * Every collection in the workspace as { id, name }, for the "file this
 * document into…" menu. A static segment beside `[collectionId]`, which Next
 * matches first; collection ids are UUIDs, so the two can never collide.
 */
export const GET = workspaceRoute(async ({ membership }) => {
  const options = await getCollectionOptions(membership.workspace.id);
  return ok(options);
});
