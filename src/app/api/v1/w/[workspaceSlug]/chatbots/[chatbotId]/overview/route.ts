import { getChatbotOverviewStats } from "@/features/chatbots/server/chatbot-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; chatbotId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  const overview = await getChatbotOverviewStats(membership.workspace.id, params.chatbotId);
  return ok(overview);
});
