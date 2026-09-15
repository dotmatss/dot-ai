import { embeddingModelUpdateSchema } from "@/features/platform/ai-schemas";
import { removeEmbeddingModel, updateEmbeddingModelSettings } from "@/features/platform/server/ai-registry-service";
import { platformRoute } from "@/server/http/platform-route";
import { parseJsonBody } from "@/server/http/request";
import { noContent, ok } from "@/server/http/responses";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

/** `dimensions` is absent from the update schema: it is not editable in place. */
export const PATCH = platformRoute<{ id: string }>(async ({ request, params, user }) => {
  const input = await parseJsonBody(request, embeddingModelUpdateSchema);
  return ok(await updateEmbeddingModelSettings({ id: user.id, email: user.email }, params.id, input), NO_STORE);
});

export const DELETE = platformRoute<{ id: string }>(async ({ params, user }) => {
  await removeEmbeddingModel({ id: user.id, email: user.email }, params.id);
  return noContent();
});
