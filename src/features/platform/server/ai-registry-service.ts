import "server-only";

import { z } from "zod";

import {
  aiModelCreateSchema,
  aiModelUpdateSchema,
  aiProviderCreateSchema,
  aiProviderUpdateSchema,
  embeddingModelCreateSchema,
  embeddingModelUpdateSchema,
} from "@/features/platform/ai-schemas";
import type { AiModelSummary, AiProviderSummary, EmbeddingModelSummary } from "@/features/platform/ai-types";
import { sealProviderCredential } from "@/features/platform/server/ai-credentials";
import {
  deleteAiModel,
  deleteAiProvider,
  deleteEmbeddingModel,
  deleteProviderCredential,
  findAiModel,
  findAiProvider,
  findEmbeddingModel,
  insertAiModel,
  insertAiProvider,
  insertEmbeddingModel,
  updateAiModel,
  updateAiProvider,
  updateEmbeddingModel,
  upsertProviderCredential,
} from "@/features/platform/server/ai-registry-repository";
import type { PlatformActor } from "@/features/platform/server/platform-service";
import { ApiError } from "@/lib/api/api-error";
import { withTransaction } from "@/server/db/client";
import { recordPlatformAudit } from "@/server/platform/platform-audit";

/**
 * Business rules for the platform AI catalogue.
 *
 * As with `platform-service.ts`: authorization is not re-implemented here (the
 * caller already passed `platformRoute`), the actor is an argument resolved
 * from the session, input is re-validated so the service is safe for any
 * caller, and every mutation shares a transaction with its audit record.
 *
 * ── The credential rule ─────────────────────────────────────────────────────
 *
 * An API key can enter through `updateProvider` and can never come back out.
 * It is sealed immediately, is never held in a returned value, and never
 * reaches an audit row - the record says `credentialChanged: true`, which is
 * the auditable fact, while the key itself is not. `redactMetadata` would
 * strip it anyway; not putting it there is the actual control.
 */

const uuidSchema = z.uuid();

function assertUuid(value: string, label: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw ApiError.badRequest(`${label} is not a valid id`);
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export async function createAiProvider(actor: PlatformActor, input: unknown): Promise<AiProviderSummary> {
  const parsed = aiProviderCreateSchema.parse(input);

  const id = await withTransaction(async (client) => {
    const providerId = await insertAiProvider(
      { slug: parsed.slug, name: parsed.name, kind: parsed.kind, baseUrl: parsed.baseUrl ?? null, enabled: parsed.enabled },
      client,
    );
    await recordPlatformAudit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: "ai.provider.created",
        targetType: "ai_provider",
        targetId: providerId,
        targetLabel: parsed.name,
        metadata: { slug: parsed.slug, kind: parsed.kind, enabled: parsed.enabled },
      },
      client,
    );
    return providerId;
  });

  const provider = await findAiProvider(id);
  if (!provider) throw ApiError.notFound("Provider not found");
  return provider;
}

export async function updateAiProviderSettings(
  actor: PlatformActor,
  providerId: string,
  input: unknown,
): Promise<AiProviderSummary> {
  const id = assertUuid(providerId, "Provider");
  const parsed = aiProviderUpdateSchema.parse(input);

  await withTransaction(async (client) => {
    const existing = await findAiProvider(id, client);
    if (!existing) throw ApiError.notFound("Provider not found");

    await updateAiProvider(id, { name: parsed.name, baseUrl: parsed.baseUrl, enabled: parsed.enabled }, client);

    // Three distinct intents: omitted leaves the stored key alone, null clears
    // it, a string replaces it. Conflating "absent" with "clear" would silently
    // erase a working credential on every unrelated edit.
    let credentialChange: "set" | "cleared" | null = null;
    if (parsed.apiKey === null) {
      await deleteProviderCredential(id, client);
      credentialChange = "cleared";
    } else if (typeof parsed.apiKey === "string") {
      await upsertProviderCredential(id, sealProviderCredential(parsed.apiKey, id), client);
      credentialChange = "set";
    }

    await recordPlatformAudit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: "ai.provider.updated",
        targetType: "ai_provider",
        targetId: id,
        targetLabel: existing.name,
        // The key is not here, and no field it could occupy is here either.
        metadata: {
          enabled: parsed.enabled ?? existing.enabled,
          credentialChange,
          renamed: parsed.name !== undefined && parsed.name !== existing.name,
        },
      },
      client,
    );
  });

  const provider = await findAiProvider(id);
  if (!provider) throw ApiError.notFound("Provider not found");
  return provider;
}

/**
 * Removes a provider.
 *
 * Refused while models reference it. The foreign key is `ON DELETE RESTRICT`,
 * so the database would refuse anyway - but it would surface as a generic
 * constraint violation, and an operator deserves to be told which catalogue
 * entries are in the way. Deleting the models first is a deliberate second act.
 */
export async function removeAiProvider(actor: PlatformActor, providerId: string): Promise<void> {
  const id = assertUuid(providerId, "Provider");

  await withTransaction(async (client) => {
    const existing = await findAiProvider(id, client);
    if (!existing) throw ApiError.notFound("Provider not found");

    const attached = existing.modelCount + existing.embeddingModelCount;
    if (attached > 0) {
      throw ApiError.conflict(
        `Remove this provider's ${attached} model${attached === 1 ? "" : "s"} before deleting it.`,
      );
    }

    // The credential row cascades with the provider, so the sealed key does not
    // outlive the thing it authenticated.
    await deleteAiProvider(id, client);
    await recordPlatformAudit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: "ai.provider.deleted",
        targetType: "ai_provider",
        targetId: id,
        targetLabel: existing.name,
        metadata: { slug: existing.slug, kind: existing.kind },
      },
      client,
    );
  });
}

// ---------------------------------------------------------------------------
// Completion models
// ---------------------------------------------------------------------------

export async function createAiModel(actor: PlatformActor, input: unknown): Promise<AiModelSummary> {
  const parsed = aiModelCreateSchema.parse(input);

  const id = await withTransaction(async (client) => {
    const provider = await findAiProvider(parsed.providerId, client);
    if (!provider) throw ApiError.badRequest("Unknown provider");

    const modelId = await insertAiModel(
      {
        providerId: parsed.providerId,
        providerModelId: parsed.providerModelId,
        slug: parsed.slug,
        displayName: parsed.displayName,
        capabilities: parsed.capabilities,
        availableFor: parsed.availableFor,
        contextWindow: parsed.contextWindow ?? null,
        inputCostPerMtok: parsed.inputCostPerMtok ?? null,
        outputCostPerMtok: parsed.outputCostPerMtok ?? null,
        status: parsed.status,
        notes: parsed.notes ?? null,
      },
      client,
    );

    await recordPlatformAudit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: "ai.model.created",
        targetType: "ai_model",
        targetId: modelId,
        targetLabel: parsed.displayName,
        metadata: {
          provider: provider.slug,
          providerModelId: parsed.providerModelId,
          capabilities: parsed.capabilities,
          availableFor: parsed.availableFor,
          status: parsed.status,
        },
      },
      client,
    );
    return modelId;
  });

  const model = await findAiModel(id);
  if (!model) throw ApiError.notFound("Model not found");
  return model;
}

/**
 * Edits a model.
 *
 * Availability changes are audited with both the previous and the next lists,
 * because "when did this model stop being offered for agents, and who did it"
 * is the question asked after a customer reports something vanished.
 */
export async function updateAiModelSettings(
  actor: PlatformActor,
  modelId: string,
  input: unknown,
): Promise<AiModelSummary> {
  const id = assertUuid(modelId, "Model");
  const parsed = aiModelUpdateSchema.parse(input);

  await withTransaction(async (client) => {
    const existing = await findAiModel(id, client);
    if (!existing) throw ApiError.notFound("Model not found");

    await updateAiModel(
      id,
      {
        displayName: parsed.displayName,
        providerModelId: parsed.providerModelId,
        capabilities: parsed.capabilities,
        availableFor: parsed.availableFor,
        contextWindow: parsed.contextWindow,
        inputCostPerMtok: parsed.inputCostPerMtok,
        outputCostPerMtok: parsed.outputCostPerMtok,
        status: parsed.status,
        notes: parsed.notes,
      },
      client,
    );

    await recordPlatformAudit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: "ai.model.updated",
        targetType: "ai_model",
        targetId: id,
        targetLabel: existing.displayName,
        metadata: {
          provider: existing.providerSlug,
          statusBefore: existing.status,
          statusAfter: parsed.status ?? existing.status,
          availableForBefore: existing.availableFor,
          availableForAfter: parsed.availableFor ?? existing.availableFor,
        },
      },
      client,
    );
  });

  const model = await findAiModel(id);
  if (!model) throw ApiError.notFound("Model not found");
  return model;
}

export async function removeAiModel(actor: PlatformActor, modelId: string): Promise<void> {
  const id = assertUuid(modelId, "Model");

  await withTransaction(async (client) => {
    const existing = await findAiModel(id, client);
    if (!existing) throw ApiError.notFound("Model not found");

    await deleteAiModel(id, client);
    await recordPlatformAudit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: "ai.model.deleted",
        targetType: "ai_model",
        targetId: id,
        targetLabel: existing.displayName,
        metadata: { provider: existing.providerSlug, slug: existing.slug },
      },
      client,
    );
  });
}

// ---------------------------------------------------------------------------
// Embedding models
// ---------------------------------------------------------------------------

export async function createEmbeddingModel(actor: PlatformActor, input: unknown): Promise<EmbeddingModelSummary> {
  const parsed = embeddingModelCreateSchema.parse(input);

  const id = await withTransaction(async (client) => {
    const provider = await findAiProvider(parsed.providerId, client);
    if (!provider) throw ApiError.badRequest("Unknown provider");

    const modelId = await insertEmbeddingModel(
      {
        providerId: parsed.providerId,
        providerModelId: parsed.providerModelId,
        slug: parsed.slug,
        displayName: parsed.displayName,
        dimensions: parsed.dimensions,
        maxInputTokens: parsed.maxInputTokens ?? null,
        costPerMtok: parsed.costPerMtok ?? null,
        status: parsed.status,
        notes: parsed.notes ?? null,
      },
      client,
    );

    await recordPlatformAudit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: "ai.embedding_model.created",
        targetType: "embedding_model",
        targetId: modelId,
        targetLabel: parsed.displayName,
        // Dimensions are recorded because they are the one value that cannot be
        // edited later, and the one that invalidates stored vectors if wrong.
        metadata: { provider: provider.slug, dimensions: parsed.dimensions, status: parsed.status },
      },
      client,
    );
    return modelId;
  });

  const model = await findEmbeddingModel(id);
  if (!model) throw ApiError.notFound("Embedding model not found");
  return model;
}

export async function updateEmbeddingModelSettings(
  actor: PlatformActor,
  modelId: string,
  input: unknown,
): Promise<EmbeddingModelSummary> {
  const id = assertUuid(modelId, "Embedding model");
  const parsed = embeddingModelUpdateSchema.parse(input);

  await withTransaction(async (client) => {
    const existing = await findEmbeddingModel(id, client);
    if (!existing) throw ApiError.notFound("Embedding model not found");

    await updateEmbeddingModel(id, parsed, client);
    await recordPlatformAudit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: "ai.embedding_model.updated",
        targetType: "embedding_model",
        targetId: id,
        targetLabel: existing.displayName,
        metadata: {
          provider: existing.providerSlug,
          statusBefore: existing.status,
          statusAfter: parsed.status ?? existing.status,
          // Unchanged by construction: `dimensions` is not in the update schema.
          dimensions: existing.dimensions,
        },
      },
      client,
    );
  });

  const model = await findEmbeddingModel(id);
  if (!model) throw ApiError.notFound("Embedding model not found");
  return model;
}

export async function removeEmbeddingModel(actor: PlatformActor, modelId: string): Promise<void> {
  const id = assertUuid(modelId, "Embedding model");

  await withTransaction(async (client) => {
    const existing = await findEmbeddingModel(id, client);
    if (!existing) throw ApiError.notFound("Embedding model not found");

    await deleteEmbeddingModel(id, client);
    await recordPlatformAudit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: "ai.embedding_model.deleted",
        targetType: "embedding_model",
        targetId: id,
        targetLabel: existing.displayName,
        metadata: { provider: existing.providerSlug, slug: existing.slug, dimensions: existing.dimensions },
      },
      client,
    );
  });
}
