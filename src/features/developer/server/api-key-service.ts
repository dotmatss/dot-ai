import "server-only";

import { requireEntitlement } from "@/features/billing/server/entitlements";
import type { CreateApiKeyInput } from "@/features/developer/schemas";
import {
  findApiKey,
  insertApiKey,
  listApiKeys,
  revokeApiKeyRow,
} from "@/features/developer/server/api-key-repository";
import { generateApiKey } from "@/features/developer/server/api-key-token";
import type { ApiKey, ApiKeyListFilters, CreatedApiKey } from "@/features/developer/types";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import type { Paginated } from "@/types/pagination";

export interface ActorContext {
  workspaceId: string;
  userId: string;
}

export function getApiKeys(workspaceId: string, filters: ApiKeyListFilters): Promise<Paginated<ApiKey>> {
  return listApiKeys(workspaceId, filters);
}

/**
 * Mints a key and stores only its hash and display prefix.
 *
 * The plaintext exists in this process for the length of one request and is
 * returned to the caller exactly once. There is no recovery path by design: a
 * lost key is revoked and replaced.
 */
export async function createApiKey(ctx: ActorContext, input: CreateApiKeyInput): Promise<CreatedApiKey> {
  // `apiAccess` is one of the two entitlements the catalogue has actually
  // decided, so it is one of the two that can be enforced. A workspace with no
  // plan is unaffected: nothing is enforced against an unassigned workspace.
  await requireEntitlement(ctx.workspaceId, "apiAccess");

  const generated = generateApiKey();
  const apiKey = await insertApiKey({
    workspaceId: ctx.workspaceId,
    createdBy: ctx.userId,
    name: input.name,
    keyPrefix: generated.prefix,
    keyHash: generated.hash,
  });

  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "api_key",
    entityId: apiKey.id,
    action: "created",
    // The prefix is display material, not a credential; the key itself is
    // never written to the audit trail.
    summary: `Created API key “${apiKey.name}”`,
    metadata: { keyPrefix: apiKey.keyPrefix },
  });

  return { apiKey, secret: generated.secret };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function revokeApiKey(ctx: ActorContext, apiKeyId: string): Promise<ApiKey> {
  // The id arrives as a path segment. Checking the shape here keeps a malformed
  // value from reaching PostgreSQL as a failed uuid cast, which would surface as
  // a 500 instead of the 404 this is.
  if (!UUID_PATTERN.test(apiKeyId)) throw ApiError.notFound("API key not found");

  const existing = await findApiKey(ctx.workspaceId, apiKeyId);
  if (!existing) throw ApiError.notFound("API key not found");
  if (existing.revokedAt) return existing;

  const revoked = await revokeApiKeyRow(ctx.workspaceId, apiKeyId);
  if (!revoked) throw ApiError.notFound("API key not found");

  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "api_key",
    entityId: apiKeyId,
    action: "revoked",
    summary: `Revoked API key “${revoked.name}”`,
    metadata: { keyPrefix: revoked.keyPrefix },
  });

  return revoked;
}
