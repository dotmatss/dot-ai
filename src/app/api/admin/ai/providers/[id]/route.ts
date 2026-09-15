import { aiProviderUpdateSchema } from "@/features/platform/ai-schemas";
import { removeAiProvider, updateAiProviderSettings } from "@/features/platform/server/ai-registry-service";
import { platformRoute } from "@/server/http/platform-route";
import { parseJsonBody } from "@/server/http/request";
import { noContent, ok } from "@/server/http/responses";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

/**
 * PATCH accepts an `apiKey` and no response ever returns one. The provider
 * summary this replies with reports `credentialConfigured` and nothing more.
 */
export const PATCH = platformRoute<{ id: string }>(async ({ request, params, user }) => {
  const input = await parseJsonBody(request, aiProviderUpdateSchema);
  return ok(await updateAiProviderSettings({ id: user.id, email: user.email }, params.id, input), NO_STORE);
});

export const DELETE = platformRoute<{ id: string }>(async ({ params, user }) => {
  await removeAiProvider({ id: user.id, email: user.email }, params.id);
  return noContent();
});
