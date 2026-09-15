import "server-only";

import { buildCredentialHeader, CredentialUnavailableError } from "@/features/integrations/credential-headers";
import {
  findCredentialRecord,
  findCredentialSecret,
  touchCredentialLastUsed,
} from "@/features/integrations/server/credential-repository";
import { credentialSecretContext, openSecretMap, SecretDecryptionError } from "@/features/integrations/server/secret-box";
import type { CredentialType } from "@/features/integrations/types";

/**
 * Opening a stored credential, ready to be sent.
 *
 * Its own module for the same reason `mcp-credentials.ts` is: this is the ONE
 * place outside the service that decrypts, and a credential that can be opened
 * in several places is a credential that can be logged in several places.
 *
 * It is also the named read model other features import - the workflow executor
 * is the only caller today. Features do not query `workspace_credentials`
 * themselves; they ask here, and what they get back is a header, never a row.
 *
 * THE RETURNED VALUE IS PLAINTEXT SECRET MATERIAL. It goes into a request and
 * nowhere else: not into a log line, not into a run step's output, not into an
 * error message, not into the audit trail.
 */

export { CredentialUnavailableError };

export interface ResolvedCredential {
  id: string;
  /** Safe to display: the operator chose it, and it names the credential, not its value. */
  name: string;
  type: CredentialType;
  headerName: string;
  headerValue: string;
}

/**
 * Resolves one credential for a request.
 *
 * Returns `null` when the id does not name a credential in this workspace - a
 * step referencing a deleted credential is a configuration problem the caller
 * reports in its own words, not an exception from here. A credential that
 * exists but cannot be used throws `CredentialUnavailableError`, because that
 * one IS worth telling the operator about specifically.
 */
export async function resolveCredential(workspaceId: string, credentialId: string): Promise<ResolvedCredential | null> {
  const record = await findCredentialRecord(workspaceId, credentialId);
  if (!record) return null;

  const sealed = await findCredentialSecret(workspaceId, credentialId);
  if (!sealed) throw new CredentialUnavailableError("No value is stored for this credential. Re-enter it and try again.");

  let secrets: Record<string, string>;
  try {
    secrets = openSecretMap(sealed, credentialSecretContext(workspaceId, credentialId));
  } catch (error) {
    if (error instanceof SecretDecryptionError) {
      // The cause is not echoed: a decryption failure must not become an oracle.
      throw new CredentialUnavailableError("The stored credential could not be read. Re-enter it and try again.");
    }
    throw error;
  }

  const header = buildCredentialHeader(record.type, record.headerName, secrets);

  // Best effort, and never awaited into the caller's failure path: last-used is
  // operational metadata and must not be able to fail a request that worked.
  void touchCredentialLastUsed(workspaceId, credentialId).catch(() => undefined);

  return { id: record.id, name: record.name, type: record.type, headerName: header.name, headerValue: header.value };
}
