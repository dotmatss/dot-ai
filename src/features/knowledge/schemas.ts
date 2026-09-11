import { z } from "zod";

import { DEFAULT_RETRIEVAL_LIMIT, TEXT_SOURCE_MAX_CHARS } from "@/features/knowledge/constants";
import { KNOWLEDGE_BASE_STATUSES } from "@/features/knowledge/types";
import { checkIngestUrl } from "@/features/knowledge/url-safety";

export const knowledgeBaseStatusSchema = z.enum(KNOWLEDGE_BASE_STATUSES);

const nameSchema = z
  .string()
  .trim()
  .min(2, { error: "Enter a name" })
  .max(80, { error: "Keep the name under 80 characters" });

const descriptionSchema = z.string().trim().max(280, { error: "Keep the description under 280 characters" });

export const createKnowledgeBaseSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
});

export type CreateKnowledgeBaseInput = z.infer<typeof createKnowledgeBaseSchema>;

export const updateKnowledgeBaseSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: "Nothing to update" });

export type UpdateKnowledgeBaseInput = z.input<typeof updateKnowledgeBaseSchema>;

export const knowledgeBaseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  status: knowledgeBaseStatusSchema.optional(),
});

export const knowledgeSourceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

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

export const knowledgeBaseSettingsFormSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
});

export type KnowledgeBaseSettingsFormValues = z.infer<typeof knowledgeBaseSettingsFormSchema>;

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
