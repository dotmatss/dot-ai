/**
 * Client-safe contracts for the platform AI catalogue.
 *
 * The load-bearing omission: **no type here carries a provider credential, or
 * any fragment of one.** A provider reports `credentialConfigured: boolean` and
 * nothing else - not a masked value, not the last four characters, not a
 * length. There is no shape in this file that a key could travel in, which is
 * a stronger guarantee than remembering to strip one.
 */

export const AI_PROVIDER_KINDS = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "azure_openai",
  "gateway",
  "custom",
] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/**
 * What a completion model can be used for.
 *
 * Embeddings are deliberately not here: an embedding model carries a dimension
 * count that has to match stored vectors, so it lives in its own registry.
 */
export const AI_CAPABILITIES = [
  "chat",
  "agent",
  "tool_calling",
  "structured_output",
  "vision",
  "reranking",
] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export const AI_MODEL_STATUSES = ["active", "deprecated", "disabled"] as const;
export type AiModelStatus = (typeof AI_MODEL_STATUSES)[number];

export interface AiProviderSummary {
  id: string;
  slug: string;
  name: string;
  kind: AiProviderKind;
  enabled: boolean;
  baseUrl: string | null;
  /** Whether a sealed credential exists. Never the credential, nor part of it. */
  credentialConfigured: boolean;
  modelCount: number;
  embeddingModelCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiModelSummary {
  id: string;
  providerId: string;
  providerSlug: string;
  providerName: string;
  providerEnabled: boolean;
  providerModelId: string;
  slug: string;
  displayName: string;
  /** What the model can do. */
  capabilities: AiCapability[];
  /** What the platform offers it for. Always a subset of `capabilities`. */
  availableFor: AiCapability[];
  contextWindow: number | null;
  /** USD per million tokens. Null means "not recorded", never "free". */
  inputCostPerMtok: number | null;
  outputCostPerMtok: number | null;
  status: AiModelStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmbeddingModelSummary {
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
  costPerMtok: number | null;
  status: AiModelStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Whether a model is actually offerable right now.
 *
 * A model is only usable if its provider is enabled AND the model is active AND
 * the platform offers it for something. Three separate switches, because they
 * fail for three different reasons and an operator needs to know which.
 */
export function isModelOffered(model: Pick<AiModelSummary, "providerEnabled" | "status" | "availableFor">): boolean {
  return model.providerEnabled && model.status === "active" && model.availableFor.length > 0;
}
