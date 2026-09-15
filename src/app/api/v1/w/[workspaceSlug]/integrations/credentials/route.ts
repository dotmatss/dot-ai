import { createCredentialSchema, credentialListQuerySchema } from "@/features/integrations/schemas";
import { createCredential, getCredentials } from "@/features/integrations/server/credential-service";
import { parseJsonBody, parseSearchParams } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/**
 * Outbound credentials: what this workspace sends to somebody else's API.
 *
 * No handler in this directory returns secret material. The list carries names,
 * kinds and the header each one sets; the write handlers accept values and
 * return the same non-secret shape back.
 */
export const GET = workspaceRoute(async ({ request, membership }) => {
  const filters = parseSearchParams(request, credentialListQuerySchema);
  const page = await getCredentials(membership.workspace.id, filters);
  return ok(page);
});

/**
 * Admin-only, matching API keys: a stored credential lets any workflow in the
 * workspace act as this workspace against a third party, which is a privilege
 * grant rather than an ordinary edit.
 */
export const POST = workspaceRoute(
  async ({ request, membership, user }) => {
    const input = await parseJsonBody(request, createCredentialSchema);
    const credential = await createCredential({ workspaceId: membership.workspace.id, userId: user.id }, input);
    return created(credential);
  },
  { minimumRole: "admin" },
);
