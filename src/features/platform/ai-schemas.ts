import { z } from "zod";

import { AI_CAPABILITIES, AI_MODEL_STATUSES, AI_PROVIDER_KINDS } from "@/features/platform/ai-types";

/**
 * Wire schemas for the AI catalogue.
 *
 * Two rules here are security decisions rather than validation niceties:
 *
 * 1. **`available_for` is never accepted without `capabilities`.** The database
 *    CHECK enforces the subset relation, but a request that changed only the
 *    offered list would be validated against whatever happens to be stored,
 *    which is a check against a moving target. Requiring both makes the
 *    relation decidable from the request itself.
 * 2. **A credential can be SET but never READ back.** `apiKey` is an input-only
 *    field; no response schema in this feature contains it. Clearing is an
 *    explicit `null`, distinguishable from "not supplied, leave alone".
 */

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, { error: "Use lowercase letters, digits and hyphens" });

/** USD per million tokens, or null for "not recorded". Never negative. */
const costSchema = z.number().min(0).max(100_000).nullable();

export const aiProviderCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  kind: z.enum(AI_PROVIDER_KINDS),
  // A base URL is only meaningful for gateway/custom providers, but it is not
  // rejected for the others: a self-hosted or proxied OpenAI-compatible
  // endpoint is a legitimate deployment, and refusing it would push operators
  // towards the 'custom' kind and lose the real provider identity.
  baseUrl: z.url().max(500).nullable().optional(),
  enabled: z.boolean().default(false),
});

export const aiProviderUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.url().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  /**
   * Input only. Omitted leaves the stored credential untouched; `null` clears
   * it; a string replaces it. It is never returned by any read.
   */
  apiKey: z.string().trim().min(1).max(500).nullable().optional(),
});

export type AiProviderCreateInput = z.infer<typeof aiProviderCreateSchema>;
export type AiProviderUpdateInput = z.infer<typeof aiProviderUpdateSchema>;

const capabilityListSchema = z.array(z.enum(AI_CAPABILITIES)).max(AI_CAPABILITIES.length);

/**
 * Refinement mirroring the database CHECK.
 *
 * Both layers, deliberately. The constraint is the guarantee; this is what
 * turns a violation into a field error the operator can act on instead of a
 * 500 from a failed write.
 */
const capabilitySubsetRule = {
  check: (value: { capabilities: string[]; availableFor: string[] }) =>
    value.availableFor.every((entry) => value.capabilities.includes(entry)),
  message: "A model cannot be offered for a capability it does not support",
  path: ["availableFor"] as const,
};

export const aiModelCreateSchema = z
  .object({
    providerId: z.uuid(),
    providerModelId: z.string().trim().min(1).max(200),
    slug: slugSchema,
    displayName: z.string().trim().min(1).max(120),
    capabilities: capabilityListSchema,
    availableFor: capabilityListSchema.default([]),
    contextWindow: z.number().int().positive().max(100_000_000).nullable().optional(),
    inputCostPerMtok: costSchema.optional(),
    outputCostPerMtok: costSchema.optional(),
    status: z.enum(AI_MODEL_STATUSES).default("active"),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((value) => capabilitySubsetRule.check(value), {
    error: capabilitySubsetRule.message,
    path: [...capabilitySubsetRule.path],
  });

export const aiModelUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    providerModelId: z.string().trim().min(1).max(200).optional(),
    // Supplied together or not at all - see the file header.
    capabilities: capabilityListSchema.optional(),
    availableFor: capabilityListSchema.optional(),
    contextWindow: z.number().int().positive().max(100_000_000).nullable().optional(),
    inputCostPerMtok: costSchema.optional(),
    outputCostPerMtok: costSchema.optional(),
    status: z.enum(AI_MODEL_STATUSES).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((value) => (value.availableFor === undefined) === (value.capabilities === undefined), {
    error: "Supply capabilities and availableFor together, so the subset rule is decidable from the request",
    path: ["availableFor"],
  })
  .refine(
    (value) =>
      value.capabilities === undefined ||
      value.availableFor === undefined ||
      capabilitySubsetRule.check({ capabilities: value.capabilities, availableFor: value.availableFor }),
    { error: capabilitySubsetRule.message, path: ["availableFor"] },
  );

export type AiModelCreateInput = z.infer<typeof aiModelCreateSchema>;
export type AiModelUpdateInput = z.infer<typeof aiModelUpdateSchema>;

/**
 * `dimensions` is required at creation and absent from the update schema.
 *
 * It is not editable, because it is not a description of the model - it is the
 * width of every vector already written using it. Changing it in place would
 * silently invalidate stored embeddings, so replacing the registry entry is the
 * only representable path.
 */
export const embeddingModelCreateSchema = z.object({
  providerId: z.uuid(),
  providerModelId: z.string().trim().min(1).max(200),
  slug: slugSchema,
  displayName: z.string().trim().min(1).max(120),
  dimensions: z.number().int().positive().max(65_536),
  maxInputTokens: z.number().int().positive().max(10_000_000).nullable().optional(),
  costPerMtok: costSchema.optional(),
  status: z.enum(AI_MODEL_STATUSES).default("active"),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const embeddingModelUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  providerModelId: z.string().trim().min(1).max(200).optional(),
  maxInputTokens: z.number().int().positive().max(10_000_000).nullable().optional(),
  costPerMtok: costSchema.optional(),
  status: z.enum(AI_MODEL_STATUSES).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export type EmbeddingModelCreateInput = z.infer<typeof embeddingModelCreateSchema>;
export type EmbeddingModelUpdateInput = z.infer<typeof embeddingModelUpdateSchema>;
