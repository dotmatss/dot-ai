import "server-only";

import { requireEntitlement } from "@/features/billing/server/entitlements";
import { CREDENTIAL_TYPE_META } from "@/features/integrations/constants";
import {
  credentialSchemaFor,
  fieldErrorsFrom,
  type CreateCredentialInput,
  type UpdateCredentialInput,
} from "@/features/integrations/schemas";
import {
  credentialNameTaken,
  deleteCredential,
  findCredential,
  findCredentialRecord,
  findCredentialSecret,
  insertCredential,
  listCredentials,
  updateCredentialRow,
  upsertCredentialSecret,
} from "@/features/integrations/server/credential-repository";
import {
  credentialSecretContext,
  openSecretMap,
  sealSecretMap,
  SecretDecryptionError,
} from "@/features/integrations/server/secret-box";
import type { Credential, CredentialListFilters, CredentialType } from "@/features/integrations/types";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import { withWorkspace } from "@/server/db/client";
import type { Paginated } from "@/types/pagination";

/**
 * Business rules for outbound credentials.
 *
 * Nothing this module returns contains secret material. It decrypts in exactly
 * one place - `storedSecrets`, when merging a partial edit - and that value
 * never leaves the function it is computed in. Sending a credential to a
 * destination is `credential-resolver.ts`, deliberately a different module with
 * a different caller.
 */

export interface ActorContext {
  workspaceId: string;
  userId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path segments arrive as strings; a malformed one is a 404, not a failed uuid cast. */
function assertCredentialId(credentialId: string): void {
  if (!UUID_PATTERN.test(credentialId)) throw ApiError.notFound("Credential not found");
}

export function getCredentials(workspaceId: string, filters: CredentialListFilters): Promise<Paginated<Credential>> {
  return listCredentials(workspaceId, filters);
}

export async function getCredential(workspaceId: string, credentialId: string): Promise<Credential> {
  assertCredentialId(credentialId);
  const credential = await findCredential(workspaceId, credentialId);
  if (!credential) throw ApiError.notFound("Credential not found");
  return credential;
}

/**
 * Opens the stored envelope so a partial edit can be merged into it.
 *
 * An envelope that will not open (a rotated APP_SECRET, a row restored from
 * another environment) is reported as empty rather than thrown, which turns
 * "unreadable" into "every field must be re-entered" - the only recovery there
 * is anyway. The log line carries no ciphertext and no context string.
 */
async function storedSecrets(workspaceId: string, credentialId: string): Promise<Record<string, string>> {
  const sealed = await findCredentialSecret(workspaceId, credentialId);
  if (!sealed) return {};
  try {
    return openSecretMap(sealed, credentialSecretContext(workspaceId, credentialId));
  } catch (error) {
    if (error instanceof SecretDecryptionError) {
      console.error(`[credentials] unreadable secret for credential ${credentialId}`);
      return {};
    }
    throw error;
  }
}

/**
 * Drops anything the kind does not declare and keeps the rest in registry
 * order, so a field removed from `CREDENTIAL_TYPE_META` cannot linger in an
 * envelope forever.
 */
function mergeSecrets(
  type: CredentialType,
  stored: Record<string, string>,
  incoming: Record<string, string | undefined>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const field of CREDENTIAL_TYPE_META[type].secretFields) {
    const supplied = incoming[field.key];
    const existing = stored[field.key];
    // Blank means "keep what is stored": that is what lets the form show a
    // Replace affordance without the current value ever reaching the browser.
    if (typeof supplied === "string" && supplied.length > 0) merged[field.key] = supplied;
    else if (existing !== undefined) merged[field.key] = existing;
  }
  return merged;
}

export async function createCredential(ctx: ActorContext, input: CreateCredentialInput): Promise<Credential> {
  // `integrations` is the other entitlement the catalogue has decided, so it is
  // the other one that can be enforced. Unassigned workspaces are unaffected.
  await requireEntitlement(ctx.workspaceId, "integrations");

  const type = input.type as CredentialType;
  const meta = CREDENTIAL_TYPE_META[type];

  const parsed = credentialSchemaFor(type, { secretsRequired: true }).safeParse({
    name: input.name,
    headerName: meta.header === null ? (input.headerName ?? "") : "",
    secrets: input.secrets ?? {},
  });
  if (!parsed.success) throw ApiError.validation(fieldErrorsFrom(parsed.error));

  if (await credentialNameTaken(ctx.workspaceId, parsed.data.name, null)) {
    throw ApiError.validation({ name: ["A credential with this name already exists"] });
  }

  const secrets = mergeSecrets(type, {}, parsed.data.secrets);
  const headerName = meta.header === null ? parsed.data.headerName : null;

  const credential = await withWorkspace(ctx.workspaceId, async (client) => {
    const credentialId = await insertCredential(
      { workspaceId: ctx.workspaceId, createdBy: ctx.userId, name: parsed.data.name, type, headerName },
      client,
    );
    await upsertCredentialSecret(
      ctx.workspaceId,
      credentialId,
      // Sealed against the credential's own id, so the envelope is useless on
      // any other row even within this workspace.
      sealSecretMap(secrets, credentialSecretContext(ctx.workspaceId, credentialId)),
      client,
    );
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "credential",
        entityId: credentialId,
        action: "created",
        summary: `Created credential “${parsed.data.name}”`,
        // Kind and field names only. A value written here would put the secret
        // in a second, unencrypted place.
        metadata: { type, fields: Object.keys(secrets) },
      },
      client,
    );
    const saved = await findCredential(ctx.workspaceId, credentialId, client);
    if (!saved) throw new Error("Credential vanished after insert");
    return saved;
  });

  return credential;
}

export async function updateCredential(
  ctx: ActorContext,
  credentialId: string,
  input: UpdateCredentialInput,
): Promise<Credential> {
  assertCredentialId(credentialId);
  const record = await findCredentialRecord(ctx.workspaceId, credentialId);
  if (!record) throw ApiError.notFound("Credential not found");

  const meta = CREDENTIAL_TYPE_META[record.type];
  const stored = await storedSecrets(ctx.workspaceId, credentialId);

  const parsed = credentialSchemaFor(record.type, { secretsRequired: false }).safeParse({
    name: input.name ?? record.name,
    headerName: meta.header === null ? (input.headerName ?? record.headerName ?? "") : "",
    secrets: input.secrets ?? {},
  });
  if (!parsed.success) throw ApiError.validation(fieldErrorsFrom(parsed.error));

  if (await credentialNameTaken(ctx.workspaceId, parsed.data.name, credentialId)) {
    throw ApiError.validation({ name: ["A credential with this name already exists"] });
  }

  const secrets = mergeSecrets(record.type, stored, parsed.data.secrets);
  // Every declared field must end up set. It can be missing only when the
  // stored envelope was unreadable and the operator left the field blank, and
  // saving then would leave a credential that cannot authenticate anything.
  const missing = meta.secretFields.filter((field) => !secrets[field.key]);
  if (missing.length > 0) {
    throw ApiError.validation(
      Object.fromEntries(missing.map((field) => [`secrets.${field.key}`, [`Enter the ${field.label.toLowerCase()}`]])),
    );
  }

  const headerName = meta.header === null ? parsed.data.headerName : null;

  const credential = await withWorkspace(ctx.workspaceId, async (client) => {
    const updated = await updateCredentialRow(
      ctx.workspaceId,
      credentialId,
      { name: parsed.data.name, headerName },
      client,
    );
    if (!updated) throw ApiError.notFound("Credential not found");

    await upsertCredentialSecret(
      ctx.workspaceId,
      credentialId,
      sealSecretMap(secrets, credentialSecretContext(ctx.workspaceId, credentialId)),
      client,
    );
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "credential",
        entityId: credentialId,
        action: "updated",
        summary: `Updated credential “${parsed.data.name}”`,
        metadata: {
          type: record.type,
          // Which fields the operator actually replaced, so a rotation is
          // visible in the audit trail without the value being in it.
          replaced: Object.keys(parsed.data.secrets).filter((key) => (parsed.data.secrets[key] ?? "").length > 0),
        },
      },
      client,
    );
    const saved = await findCredential(ctx.workspaceId, credentialId, client);
    if (!saved) throw new Error("Credential vanished after update");
    return saved;
  });

  return credential;
}

/**
 * Deletes a credential and, by cascade, its sealed envelope.
 *
 * Steps referencing it are left alone on purpose. Rewriting a workflow
 * definition from here would edit another feature's data behind its back, and
 * the step's own failure - "the credential is no longer available" - is the
 * honest, visible outcome.
 */
export async function removeCredential(ctx: ActorContext, credentialId: string): Promise<void> {
  assertCredentialId(credentialId);
  await withWorkspace(ctx.workspaceId, async (client) => {
    const record = await findCredentialRecord(ctx.workspaceId, credentialId, client);
    if (!record) throw ApiError.notFound("Credential not found");
    const deleted = await deleteCredential(ctx.workspaceId, credentialId, client);
    if (!deleted) throw ApiError.notFound("Credential not found");
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "credential",
        entityId: credentialId,
        action: "deleted",
        summary: `Deleted credential “${record.name}”`,
        metadata: { type: record.type },
      },
      client,
    );
  });
}
