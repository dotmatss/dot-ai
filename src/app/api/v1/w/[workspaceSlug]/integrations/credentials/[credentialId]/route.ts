import { updateCredentialSchema } from "@/features/integrations/schemas";
import { getCredential, removeCredential, updateCredential } from "@/features/integrations/server/credential-service";
import { parseJsonBody } from "@/server/http/request";
import { noContent, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; credentialId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  const credential = await getCredential(membership.workspace.id, params.credentialId);
  return ok(credential);
});

/**
 * Replaces the values the caller supplies and keeps the rest. A blank field is
 * "keep what is stored", which is what lets the form offer Replace without ever
 * having received the current value.
 */
export const PATCH = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const input = await parseJsonBody(request, updateCredentialSchema);
    const credential = await updateCredential(
      { workspaceId: membership.workspace.id, userId: user.id },
      params.credentialId,
      input,
    );
    return ok(credential);
  },
  { minimumRole: "admin" },
);

/** Destroys the stored value. Steps still referencing it start failing, visibly. */
export const DELETE = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    await removeCredential({ workspaceId: membership.workspace.id, userId: user.id }, params.credentialId);
    return noContent();
  },
  { minimumRole: "admin" },
);
