import { organizationStatusSchema } from "@/features/platform/schemas";
import { getOrganizationDetail } from "@/features/platform/server/platform-repository";
import { changeOrganizationStatus } from "@/features/platform/server/platform-service";
import { ApiError } from "@/lib/api/api-error";
import { platformRoute } from "@/server/http/platform-route";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/responses";

/**
 * `no-store` on every response: this is cross-tenant operator data, and a
 * shared cache is the one place it must never end up.
 */
const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

export const GET = platformRoute<{ id: string }>(async ({ params }) => {
  const organization = await getOrganizationDetail(params.id);
  if (!organization) throw ApiError.notFound("Organization not found");
  return ok(organization, NO_STORE);
});

/**
 * The actor comes from the platform context, never from the request body.
 * An audit trail whose actor is supplied by the caller records a claim rather
 * than a fact.
 */
export const PATCH = platformRoute<{ id: string }>(async ({ request, params, user }) => {
  const input = await parseJsonBody(request, organizationStatusSchema);
  return ok(await changeOrganizationStatus({ id: user.id, email: user.email }, params.id, input), NO_STORE);
});
