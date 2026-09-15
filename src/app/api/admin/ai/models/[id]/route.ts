import { aiModelUpdateSchema } from "@/features/platform/ai-schemas";
import { removeAiModel, updateAiModelSettings } from "@/features/platform/server/ai-registry-service";
import { platformRoute } from "@/server/http/platform-route";
import { parseJsonBody } from "@/server/http/request";
import { noContent, ok } from "@/server/http/responses";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

export const PATCH = platformRoute<{ id: string }>(async ({ request, params, user }) => {
  const input = await parseJsonBody(request, aiModelUpdateSchema);
  return ok(await updateAiModelSettings({ id: user.id, email: user.email }, params.id, input), NO_STORE);
});

export const DELETE = platformRoute<{ id: string }>(async ({ params, user }) => {
  await removeAiModel({ id: user.id, email: user.email }, params.id);
  return noContent();
});
