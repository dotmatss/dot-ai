import { z } from "zod";

import { DEFAULT_RETRIEVAL_LIMIT, TEXT_SOURCE_MAX_CHARS } from "@/features/knowledge/constants";
import {
  COLLECTION_STATUSES,
  KNOWLEDGE_SCOPE_ALL,
  KNOWLEDGE_SCOPE_UNORGANIZED,
  KNOWLEDGE_SOURCE_STATUSES,
  collectionScope,
  type KnowledgeScope,
} from "@/features/knowledge/types";
import { checkIngestUrl } from "@/features/knowledge/url-safety";

export const collectionStatusSchema = z.enum(COLLECTION_STATUSES);
export const knowledgeSourceStatusSchema = z.enum(KNOWLEDGE_SOURCE_STATUSES);

const nameSchema = z
  .string()
  .trim()
  .min(2, { error: "Enter a name" })
  .max(80, { error: "Keep the name under 80 characters" });

const descriptionSchema = z.string().trim().max(280, { error: "Keep the description under 280 characters" });

export const createCollectionSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
});

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

export const updateCollectionSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: "Nothing to update" });

export type UpdateCollectionInput = z.input<typeof updateCollectionSchema>;

export const collectionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  status: collectionStatusSchema.optional(),
});

/**
 * Which documents a listing covers, as it travels in a query string.
 *
 * "all" and "unorganized" are reserved words rather than magic ids, so a
 * collection whose id happened to be typed into the URL can never be confused
 * with either — and a caller that forgets the parameter gets "all" and not, by
 * accident, everything unfiled.
 */
export const knowledgeScopeParamSchema = z.union([z.literal("all"), z.literal("unorganized"), z.uuid()]);

export function toKnowledgeScope(param: z.infer<typeof knowledgeScopeParamSchema>): KnowledgeScope {
  if (param === "all") return KNOWLEDGE_SCOPE_ALL;
  if (param === "unorganized") return KNOWLEDGE_SCOPE_UNORGANIZED;
  return collectionScope(param);
}

export const knowledgeSourceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  status: knowledgeSourceStatusSchema.optional(),
  scope: knowledgeScopeParamSchema.default("all"),
});

/** Adding a document straight into a collection, or to Unorganized with null. */
export const createSourceTargetSchema = z.object({
  collectionId: z.uuid().nullish(),
});

/**
 * Filing a document. `collectionId: null` moves it back to Unorganized, which
 * is why this is nullable rather than optional — omitting the key and clearing
 * it have to be distinguishable.
 */
export const moveSourceSchema = z.object({
  collectionId: z.uuid({ error: "Choose a collection" }).nullable(),
});

export type MoveSourceInput = z.infer<typeof moveSourceSchema>;

/**
 * A URL that passed every SSRF guard, normalized to its canonical href. The
 * same predicate runs again on each redirect hop server-side; validating here
 * means the user gets the real reason in the form instead of a generic error.
 */
export const ingestUrlSchema = z.string().transform((value, ctx) => {
  const result = checkIngestUrl(value);
  if (!result.ok) {
    ctx.addIssue(result.reason);
    return z.NEVER;
  }
  return result.url.href;
});

const sourceNameSchema = z.string().trim().min(1, { error: "Enter a name" }).max(160, { error: "Keep the name under 160 characters" });

export const createTextSourceSchema = z.object({
  type: z.literal("text"),
  name: sourceNameSchema,
  content: z
    .string()
    .trim()
    .min(1, { error: "Paste the content to index" })
    .max(TEXT_SOURCE_MAX_CHARS, { error: "That is larger than 500,000 characters; split it into several sources" }),
});

export const createUrlSourceSchema = z.object({
  type: z.literal("url"),
  url: ingestUrlSchema,
  /** Falls back to the page title, then the URL, when omitted. */
  name: sourceNameSchema.optional(),
});

export const createSourceSchema = z.discriminatedUnion("type", [createTextSourceSchema, createUrlSourceSchema]);

export type CreateSourceInput = z.output<typeof createSourceSchema>;

export const knowledgeSearchSchema = z.object({
  query: z.string().trim().min(2, { error: "Enter at least two characters" }).max(500, { error: "Keep the query under 500 characters" }),
  limit: z.coerce.number().int().min(1).max(20).default(DEFAULT_RETRIEVAL_LIMIT),
});

export type KnowledgeSearchInput = z.infer<typeof knowledgeSearchSchema>;

/* -------------------------------------------------------------------------- */
/* Form-facing schemas                                                        */
/* -------------------------------------------------------------------------- */

export const collectionSettingsFormSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
});

export type CollectionSettingsFormValues = z.infer<typeof collectionSettingsFormSchema>;

export const textSourceFormSchema = createTextSourceSchema.omit({ type: true });
export type TextSourceFormValues = z.infer<typeof textSourceFormSchema>;

/** `url` reuses the ingestion guard so the form reports the real reason a host was refused. */
export const urlSourceFormSchema = z.object({
  url: ingestUrlSchema,
  name: z.string().trim().max(160, { error: "Keep the name under 160 characters" }),
});
export type UrlSourceFormValues = z.infer<typeof urlSourceFormSchema>;

export const knowledgeSearchFormSchema = z.object({
  query: knowledgeSearchSchema.shape.query,
});
export type KnowledgeSearchFormValues = z.infer<typeof knowledgeSearchFormSchema>;
