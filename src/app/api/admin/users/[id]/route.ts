import { userStateSchema } from "@/features/platform/schemas";
import { getUserDetail } from "@/features/platform/server/platform-repository";
import { changeUserState } from "@/features/platform/server/platform-service";
import { ApiError } from "@/lib/api/api-error";
import { platformRoute } from "@/server/http/platform-route";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/responses";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

export const GET = platformRoute<{ id: string }>(async ({ params }) => {
  const user = await getUserDetail(params.id);
  if (!user) throw ApiError.notFound("User not found");
  return ok(user, NO_STORE);
});

/** The actor is taken from the platform context, never from the body. */
export const PATCH = platformRoute<{ id: string }>(async ({ request, params, user }) => {
  const input = await parseJsonBody(request, userStateSchema);
  return ok(await changeUserState({ id: user.id, email: user.email }, params.id, input), NO_STORE);
});
