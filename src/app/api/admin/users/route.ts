import { platformUserListQuerySchema } from "@/features/platform/schemas";
import { listUsers } from "@/features/platform/server/platform-repository";
import { platformRoute } from "@/server/http/platform-route";
import { parseSearchParams } from "@/server/http/request";
import { ok } from "@/server/http/responses";

export const GET = platformRoute(async ({ request }) => {
  const filters = parseSearchParams(request, platformUserListQuerySchema);
  return ok(await listUsers(filters), { headers: { "Cache-Control": "private, no-store" } });
});
