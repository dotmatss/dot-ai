import { embeddingModelCreateSchema } from "@/features/platform/ai-schemas";
import { listEmbeddingModels } from "@/features/platform/server/ai-registry-repository";
import { createEmbeddingModel } from "@/features/platform/server/ai-registry-service";
import { platformRoute } from "@/server/http/platform-route";
import { parseJsonBody } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

export const GET = platformRoute(async () => ok(await listEmbeddingModels(), NO_STORE));

export const POST = platformRoute(async ({ request, user }) => {
  const input = await parseJsonBody(request, embeddingModelCreateSchema);
  return created(await createEmbeddingModel({ id: user.id, email: user.email }, input));
});
