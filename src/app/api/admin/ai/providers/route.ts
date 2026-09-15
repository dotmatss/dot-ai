import { aiProviderCreateSchema } from "@/features/platform/ai-schemas";
import { listAiProviders } from "@/features/platform/server/ai-registry-repository";
import { createAiProvider } from "@/features/platform/server/ai-registry-service";
import { platformRoute } from "@/server/http/platform-route";
import { parseJsonBody } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";

/**
 * Operator data crossing every tenant: never cacheable by a shared cache.
 *
 * The body is parsed with the same schema the service re-validates against.
 * Parsing here is what turns a bad request into per-field errors the form can
 * render; the service's own parse is what keeps it safe for any other caller.
 */
const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

export const GET = platformRoute(async () => ok(await listAiProviders(), NO_STORE));

export const POST = platformRoute(async ({ request, user }) => {
  const input = await parseJsonBody(request, aiProviderCreateSchema);
  return created(await createAiProvider({ id: user.id, email: user.email }, input));
});
