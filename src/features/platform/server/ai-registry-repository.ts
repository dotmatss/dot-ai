import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";

import type {
  AiCapability,
  AiModelStatus,
  AiModelSummary,
  AiProviderKind,
  AiProviderSummary,
  EmbeddingModelSummary,
} from "@/features/platform/ai-types";
import type { SealedSecret } from "@/features/platform/server/ai-credentials";
import { withDb, type DatabaseClient } from "@/server/db/client";
import { aiModels, aiProviderCredentials, aiProviders, embeddingModels } from "@/server/db/schema";
import { toIsoRequired } from "@/server/db/sql";

/** Connection-less builder, used only to COMPOSE correlated subqueries. */
const qb = new QueryBuilder();

/**
 * Reads and writes for the platform AI catalogue.
 *
 * ── The rule this file exists to keep ───────────────────────────────────────
 *
 * The projections below NEVER select the credential columns into a summary. A
 * provider's credential state is expressed as a boolean computed in SQL
 * (`EXISTS(...) AS credentialConfigured`), so there is no code path where a key
 * is loaded into a shape that a route could serialize by accident.
 *
 * `findProviderCredential` is the single exception, is named so that grepping
 * for it finds every caller, and returns the sealed envelope rather than
 * plaintext - opening it requires `openProviderCredential` and the provider id
 * as its binding context.
 *
 * `tests/unit/ai-registry.test.ts` asserts that only that function and
 * `upsertProviderCredential` name those columns at all, so widening the
 * projections is a visible decision rather than a quiet one.
 *
 * ── Partial updates ─────────────────────────────────────────────────────────
 *
 * Each `update*` builds its SET list from the keys actually present. That is
 * what keeps "not supplied" distinct from "set to null" without the paired
 * `COALESCE`/`CASE WHEN $n::boolean` flags the hand-written statements needed:
 * an absent key is simply not in the statement.
 */

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

interface ProviderRow {
  id: string;
  slug: string;
  name: string;
  kind: AiProviderKind;
  enabled: boolean;
  baseUrl: string | null;
  credentialConfigured: boolean;
  modelCount: number;
  embeddingModelCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function mapProvider(row: ProviderRow): AiProviderSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    enabled: row.enabled,
    baseUrl: row.baseUrl,
    credentialConfigured: row.credentialConfigured,
    modelCount: Number(row.modelCount),
    embeddingModelCount: Number(row.embeddingModelCount),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

/** Note what is absent: only whether a credential exists, never the envelope. */
const providerSelection = {
  id: aiProviders.id,
  slug: aiProviders.slug,
  name: aiProviders.name,
  kind: aiProviders.kind,
  enabled: aiProviders.enabled,
  baseUrl: aiProviders.baseUrl,
  createdAt: aiProviders.createdAt,
  updatedAt: aiProviders.updatedAt,
  // Composed rather than templated: in a select list with no join Drizzle drops
  // the table name from an interpolated column, which would make this read
  // `WHERE "provider_id" = "id"` inside the subquery - always false here, so
  // every provider would report itself as having no credential.
  credentialConfigured: sql<boolean>`EXISTS ${qb
    .select({ one: sql`1` })
    .from(aiProviderCredentials)
    .where(eq(aiProviderCredentials.providerId, aiProviders.id))}`,
  modelCount: sql<number>`${qb
    .select({ c: sql`count(*)` })
    .from(aiModels)
    .where(eq(aiModels.providerId, aiProviders.id))}`.mapWith(Number),
  embeddingModelCount: sql<number>`${qb
    .select({ c: sql`count(*)` })
    .from(embeddingModels)
    .where(eq(embeddingModels.providerId, aiProviders.id))}`.mapWith(Number),
};

export async function listAiProviders(): Promise<AiProviderSummary[]> {
  const rows = await withDb((db) =>
    db.select(providerSelection).from(aiProviders).orderBy(asc(aiProviders.name), asc(aiProviders.id)),
  );
  return rows.map(mapProvider);
}

export async function findAiProvider(providerId: string, client?: DatabaseClient): Promise<AiProviderSummary | null> {
  const rows = await withDb(
    (db) => db.select(providerSelection).from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1),
    client,
  );
  return rows[0] ? mapProvider(rows[0]) : null;
}

export async function insertAiProvider(
  input: { slug: string; name: string; kind: string; baseUrl: string | null; enabled: boolean },
  client?: DatabaseClient,
): Promise<string> {
  const rows = await withDb(
    (db) =>
      db
        .insert(aiProviders)
        .values({
          slug: input.slug,
          name: input.name,
          kind: input.kind as AiProviderKind,
          baseUrl: input.baseUrl,
          enabled: input.enabled,
        })
        .returning({ id: aiProviders.id }),
    client,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Failed to create provider");
  return id;
}

export async function updateAiProvider(
  providerId: string,
  patch: { name?: string; baseUrl?: string | null; enabled?: boolean },
  client?: DatabaseClient,
): Promise<void> {
  const values: Partial<typeof aiProviders.$inferInsert> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.enabled !== undefined) values.enabled = patch.enabled;
  // `baseUrl` is genuinely nullable, so an explicit null clears it.
  if (patch.baseUrl !== undefined) values.baseUrl = patch.baseUrl;
  if (Object.keys(values).length === 0) return;

  await withDb((db) => db.update(aiProviders).set(values).where(eq(aiProviders.id, providerId)), client);
}

export async function deleteAiProvider(providerId: string, client?: DatabaseClient): Promise<void> {
  await withDb((db) => db.delete(aiProviders).where(eq(aiProviders.id, providerId)), client);
}

// ---------------------------------------------------------------------------
// Provider credentials - the only place the sealed envelope is touched
// ---------------------------------------------------------------------------

export async function upsertProviderCredential(
  providerId: string,
  sealed: SealedSecret,
  client?: DatabaseClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .insert(aiProviderCredentials)
        .values({ providerId, ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag })
        .onConflictDoUpdate({
          target: aiProviderCredentials.providerId,
          set: { ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag },
        }),
    client,
  );
}

export async function deleteProviderCredential(providerId: string, client?: DatabaseClient): Promise<void> {
  await withDb((db) => db.delete(aiProviderCredentials).where(eq(aiProviderCredentials.providerId, providerId)), client);
}

/**
 * The sealed envelope for a provider, or null.
 *
 * Deliberately the only function in this module that reads those columns, and
 * deliberately returns ciphertext rather than plaintext: opening it needs
 * `openProviderCredential(sealed, providerId)`, so the binding context cannot
 * be forgotten by a caller that only has the row.
 */
export async function findProviderCredential(providerId: string, client?: DatabaseClient): Promise<SealedSecret | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          ciphertext: aiProviderCredentials.ciphertext,
          iv: aiProviderCredentials.iv,
          tag: aiProviderCredentials.tag,
        })
        .from(aiProviderCredentials)
        .where(eq(aiProviderCredentials.providerId, providerId))
        .limit(1),
    client,
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Completion models
// ---------------------------------------------------------------------------

interface ModelRow {
  id: string;
  providerId: string;
  providerSlug: string;
  providerName: string;
  providerEnabled: boolean;
  providerModelId: string;
  slug: string;
  displayName: string;
  capabilities: AiCapability[] | null;
  availableFor: AiCapability[] | null;
  contextWindow: number | null;
  inputCostPerMtok: string | null;
  outputCostPerMtok: string | null;
  status: AiModelStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `numeric` arrives from the driver as a string to preserve exactness. It is
 * parsed once, here, so no component has to remember; null stays null, because
 * "not recorded" and "free" are different facts.
 */
function toCost(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** The inverse: a cost goes back as a string so `numeric` keeps its exactness. */
function fromCost(value: number | null): string | null {
  return value === null ? null : String(value);
}

function mapModel(row: ModelRow): AiModelSummary {
  return {
    id: row.id,
    providerId: row.providerId,
    providerSlug: row.providerSlug,
    providerName: row.providerName,
    providerEnabled: row.providerEnabled,
    providerModelId: row.providerModelId,
    slug: row.slug,
    displayName: row.displayName,
    capabilities: row.capabilities ?? [],
    availableFor: row.availableFor ?? [],
    contextWindow: row.contextWindow,
    inputCostPerMtok: toCost(row.inputCostPerMtok),
    outputCostPerMtok: toCost(row.outputCostPerMtok),
    status: row.status,
    notes: row.notes,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

const modelSelection = {
  id: aiModels.id,
  providerId: aiModels.providerId,
  providerSlug: aiProviders.slug,
  providerName: aiProviders.name,
  providerEnabled: aiProviders.enabled,
  providerModelId: aiModels.providerModelId,
  slug: aiModels.slug,
  displayName: aiModels.displayName,
  capabilities: aiModels.capabilities,
  availableFor: aiModels.availableFor,
  contextWindow: aiModels.contextWindow,
  inputCostPerMtok: aiModels.inputCostPerMtok,
  outputCostPerMtok: aiModels.outputCostPerMtok,
  status: aiModels.status,
  notes: aiModels.notes,
  createdAt: aiModels.createdAt,
  updatedAt: aiModels.updatedAt,
};

export async function listAiModels(): Promise<AiModelSummary[]> {
  const rows = await withDb((db) =>
    db
      .select(modelSelection)
      .from(aiModels)
      .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
      .orderBy(asc(aiProviders.name), asc(aiModels.displayName), asc(aiModels.id)),
  );
  return rows.map(mapModel);
}

export async function findAiModel(modelId: string, client?: DatabaseClient): Promise<AiModelSummary | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(modelSelection)
        .from(aiModels)
        .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
        .where(eq(aiModels.id, modelId))
        .limit(1),
    client,
  );
  return rows[0] ? mapModel(rows[0]) : null;
}

export async function insertAiModel(
  input: {
    providerId: string;
    providerModelId: string;
    slug: string;
    displayName: string;
    capabilities: string[];
    availableFor: string[];
    contextWindow: number | null;
    inputCostPerMtok: number | null;
    outputCostPerMtok: number | null;
    status: string;
    notes: string | null;
  },
  client?: DatabaseClient,
): Promise<string> {
  const rows = await withDb(
    (db) =>
      db
        .insert(aiModels)
        .values({
          providerId: input.providerId,
          providerModelId: input.providerModelId,
          slug: input.slug,
          displayName: input.displayName,
          capabilities: input.capabilities as AiCapability[],
          availableFor: input.availableFor as AiCapability[],
          contextWindow: input.contextWindow,
          inputCostPerMtok: fromCost(input.inputCostPerMtok),
          outputCostPerMtok: fromCost(input.outputCostPerMtok),
          status: input.status as AiModelStatus,
          notes: input.notes,
        })
        .returning({ id: aiModels.id }),
    client,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Failed to create model");
  return id;
}

export async function updateAiModel(
  modelId: string,
  patch: {
    displayName?: string;
    providerModelId?: string;
    capabilities?: string[];
    availableFor?: string[];
    contextWindow?: number | null;
    inputCostPerMtok?: number | null;
    outputCostPerMtok?: number | null;
    status?: string;
    notes?: string | null;
  },
  client?: DatabaseClient,
): Promise<void> {
  const values: Partial<typeof aiModels.$inferInsert> = {};
  if (patch.displayName !== undefined) values.displayName = patch.displayName;
  if (patch.providerModelId !== undefined) values.providerModelId = patch.providerModelId;
  if (patch.capabilities !== undefined) values.capabilities = patch.capabilities as AiCapability[];
  if (patch.availableFor !== undefined) values.availableFor = patch.availableFor as AiCapability[];
  // The nullable fields: an explicit null clears them, an absent key leaves them.
  if (patch.contextWindow !== undefined) values.contextWindow = patch.contextWindow;
  if (patch.inputCostPerMtok !== undefined) values.inputCostPerMtok = fromCost(patch.inputCostPerMtok);
  if (patch.outputCostPerMtok !== undefined) values.outputCostPerMtok = fromCost(patch.outputCostPerMtok);
  if (patch.status !== undefined) values.status = patch.status as AiModelStatus;
  if (patch.notes !== undefined) values.notes = patch.notes;
  if (Object.keys(values).length === 0) return;

  await withDb((db) => db.update(aiModels).set(values).where(eq(aiModels.id, modelId)), client);
}

export async function deleteAiModel(modelId: string, client?: DatabaseClient): Promise<void> {
  await withDb((db) => db.delete(aiModels).where(eq(aiModels.id, modelId)), client);
}

// ---------------------------------------------------------------------------
// Embedding models
// ---------------------------------------------------------------------------

interface EmbeddingRow {
  id: string;
  providerId: string;
  providerSlug: string;
  providerName: string;
  providerEnabled: boolean;
  providerModelId: string;
  slug: string;
  displayName: string;
  dimensions: number;
  maxInputTokens: number | null;
  costPerMtok: string | null;
  status: AiModelStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapEmbedding(row: EmbeddingRow): EmbeddingModelSummary {
  return {
    id: row.id,
    providerId: row.providerId,
    providerSlug: row.providerSlug,
    providerName: row.providerName,
    providerEnabled: row.providerEnabled,
    providerModelId: row.providerModelId,
    slug: row.slug,
    displayName: row.displayName,
    dimensions: row.dimensions,
    maxInputTokens: row.maxInputTokens,
    costPerMtok: toCost(row.costPerMtok),
    status: row.status,
    notes: row.notes,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

const embeddingSelection = {
  id: embeddingModels.id,
  providerId: embeddingModels.providerId,
  providerSlug: aiProviders.slug,
  providerName: aiProviders.name,
  providerEnabled: aiProviders.enabled,
  providerModelId: embeddingModels.providerModelId,
  slug: embeddingModels.slug,
  displayName: embeddingModels.displayName,
  dimensions: embeddingModels.dimensions,
  maxInputTokens: embeddingModels.maxInputTokens,
  costPerMtok: embeddingModels.costPerMtok,
  status: embeddingModels.status,
  notes: embeddingModels.notes,
  createdAt: embeddingModels.createdAt,
  updatedAt: embeddingModels.updatedAt,
};

export async function listEmbeddingModels(): Promise<EmbeddingModelSummary[]> {
  const rows = await withDb((db) =>
    db
      .select(embeddingSelection)
      .from(embeddingModels)
      .innerJoin(aiProviders, eq(aiProviders.id, embeddingModels.providerId))
      .orderBy(asc(aiProviders.name), asc(embeddingModels.displayName), asc(embeddingModels.id)),
  );
  return rows.map(mapEmbedding);
}

export async function findEmbeddingModel(modelId: string, client?: DatabaseClient): Promise<EmbeddingModelSummary | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(embeddingSelection)
        .from(embeddingModels)
        .innerJoin(aiProviders, eq(aiProviders.id, embeddingModels.providerId))
        .where(eq(embeddingModels.id, modelId))
        .limit(1),
    client,
  );
  return rows[0] ? mapEmbedding(rows[0]) : null;
}

export async function insertEmbeddingModel(
  input: {
    providerId: string;
    providerModelId: string;
    slug: string;
    displayName: string;
    dimensions: number;
    maxInputTokens: number | null;
    costPerMtok: number | null;
    status: string;
    notes: string | null;
  },
  client?: DatabaseClient,
): Promise<string> {
  const rows = await withDb(
    (db) =>
      db
        .insert(embeddingModels)
        .values({
          providerId: input.providerId,
          providerModelId: input.providerModelId,
          slug: input.slug,
          displayName: input.displayName,
          dimensions: input.dimensions,
          maxInputTokens: input.maxInputTokens,
          costPerMtok: fromCost(input.costPerMtok),
          status: input.status as AiModelStatus,
          notes: input.notes,
        })
        .returning({ id: embeddingModels.id }),
    client,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Failed to create embedding model");
  return id;
}

/** `dimensions` is absent on purpose - see `embeddingModelUpdateSchema`. */
export async function updateEmbeddingModel(
  modelId: string,
  patch: {
    displayName?: string;
    providerModelId?: string;
    maxInputTokens?: number | null;
    costPerMtok?: number | null;
    status?: string;
    notes?: string | null;
  },
  client?: DatabaseClient,
): Promise<void> {
  const values: Partial<typeof embeddingModels.$inferInsert> = {};
  if (patch.displayName !== undefined) values.displayName = patch.displayName;
  if (patch.providerModelId !== undefined) values.providerModelId = patch.providerModelId;
  if (patch.maxInputTokens !== undefined) values.maxInputTokens = patch.maxInputTokens;
  if (patch.costPerMtok !== undefined) values.costPerMtok = fromCost(patch.costPerMtok);
  if (patch.status !== undefined) values.status = patch.status as AiModelStatus;
  if (patch.notes !== undefined) values.notes = patch.notes;
  if (Object.keys(values).length === 0) return;

  await withDb((db) => db.update(embeddingModels).set(values).where(eq(embeddingModels.id, modelId)), client);
}

export async function deleteEmbeddingModel(modelId: string, client?: DatabaseClient): Promise<void> {
  await withDb((db) => db.delete(embeddingModels).where(eq(embeddingModels.id, modelId)), client);
}
