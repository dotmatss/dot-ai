import { aiModelCreateSchema } from "@/features/platform/ai-schemas";
import { listAiModels } from "@/features/platform/server/ai-registry-repository";
import { createAiModel } from "@/features/platform/server/ai-registry-service";
import { platformRoute } from "@/server/http/platform-route";
import { parseJsonBody } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

export const GET = platformRoute(async () => ok(await listAiModels(), NO_STORE));

export const POST = platformRoute(async ({ request, user }) => {
  const input = await parseJsonBody(request, aiModelCreateSchema);
  return created(await createAiModel({ id: user.id, email: user.email }, input));
});
