import { platformAuditListQuerySchema } from "@/features/platform/schemas";
import { listPlatformAudit } from "@/features/platform/server/platform-repository";
import { platformRoute } from "@/server/http/platform-route";
import { parseSearchParams } from "@/server/http/request";
import { ok } from "@/server/http/responses";

export const GET = platformRoute(async ({ request }) => {
  const filters = parseSearchParams(request, platformAuditListQuerySchema);
  return ok(await listPlatformAudit(filters), { headers: { "Cache-Control": "private, no-store" } });
});
