import "server-only";

import { openSecret, SecretDecryptionError } from "@/features/integrations/server/secret-box";
import { MCP_DEFAULT_CREDENTIAL_HEADER } from "@/features/mcp/constants";
import { accessTokenFor } from "@/features/mcp/server/mcp-oauth";
import type { McpAuthKind } from "@/features/mcp/types";
import * as repository from "@/features/mcp/server/mcp-repository";
import type { McpConnectionConfig } from "@/features/mcp/server/mcp-client";
import { ApiError } from "@/lib/api/api-error";

/**
 * Opening an MCP server's stored credential.
 *
 * Its own module because two callers need it — configuration (probe, discover)
 * and execution — and a credential that can be opened in two places is a
 * credential that can be logged in two places. Everything about the binding
 * context lives here.
 *
 * The plaintext returned by `connectionFor` is handed straight to the guarded
 * transport and must never be logged, returned to a client, put in an error
 * message or written to an audit row.
 */

/**
 * Binding context for the secret box. Workspace first, so a ciphertext lifted
 * into another workspace's row fails to open rather than silently decrypting.
 */
export function secretContext(workspaceId: string, serverId: string): string {
  return `mcp:${workspaceId}:${serverId}`;
}

/**
 * Opens the credential for a server, ready for the transport.
 *
 * Which credential depends on how the server is configured:
 *
 *  - `oauth` uses the stored access token, refreshed here if it is close to
 *    expiry. It travels as a bearer token, which routes it through the SDK's
 *    own `AuthProvider` and therefore through the specification's 401 handling.
 *  - `header` uses the static credential the customer pasted in.
 *  - `none` sends nothing.
 *
 * A missing or unusable OAuth token yields no credential rather than an error.
 * The server's own 401 is then what tells the customer to re-authorize, which
 * is more honest than this layer guessing.
 */
export async function connectionFor(
  workspaceId: string,
  serverId: string,
  endpointUrl: string,
  authKind: McpAuthKind = "header",
): Promise<McpConnectionConfig> {
  if (authKind === "none") return { endpointUrl, credentialHeader: null, credential: null };

  if (authKind === "oauth") {
    const token = await accessTokenFor(workspaceId, serverId);
    if (!token) return { endpointUrl, credentialHeader: null, credential: null };
    return { endpointUrl, credentialHeader: MCP_DEFAULT_CREDENTIAL_HEADER, credential: token };
  }

  const stored = await repository.findServerSecret(workspaceId, serverId);
  if (!stored) return { endpointUrl, credentialHeader: null, credential: null };

  try {
    return {
      endpointUrl,
      credentialHeader: stored.headerName,
      credential: openSecret(stored, secretContext(workspaceId, serverId)),
    };
  } catch (error) {
    // A sealed secret that will not open is a configuration problem the
    // customer can fix by re-entering it, not a 500. The cause is not echoed.
    if (error instanceof SecretDecryptionError) {
      throw ApiError.badRequest("The stored credential could not be read. Re-enter it and try again.");
    }
    throw error;
  }
}
