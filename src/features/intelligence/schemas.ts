import { z } from "zod";

import {
  DEFAULT_ANALYSIS_WINDOW_DAYS,
  MAX_ANALYSIS_WINDOW_DAYS,
  MAX_TOPIC_LABEL_CHARS,
  MAX_TOPIC_SUMMARY_CHARS,
} from "@/features/intelligence/constants";
import { TOPIC_SORTS } from "@/features/intelligence/types";
import { MAX_PAGE_SIZE } from "@/types/pagination";

export const topicSortSchema = z.enum(TOPIC_SORTS);

export const topicListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  q: z.string().trim().max(200).optional(),
  // A URL flag, so the string forms a browser actually sends all collapse here
  // rather than each caller re-deciding what "?gaps=" means.
  gaps: z
    .union([z.literal(""), z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
    .optional()
    .transform((value) => value !== undefined && value !== "0" && value !== "false"),
  sort: topicSortSchema.default("volume"),
});

export const topicConversationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

/**
 * Starting an analysis.
 *
 * The window is a count of days rather than a date pair on purpose: the run
 * clamps it, and a caller that can name an arbitrary `window_start` can ask for
 * a scan of every conversation the workspace has ever had.
 */
export const runAnalysisSchema = z.object({
  windowDays: z.coerce
    .number()
    .int()
    .min(1, { error: "Analyze at least one day" })
    .max(MAX_ANALYSIS_WINDOW_DAYS, { error: `Up to ${MAX_ANALYSIS_WINDOW_DAYS} days` })
    .default(DEFAULT_ANALYSIS_WINDOW_DAYS),
});

export type RunAnalysisInput = z.infer<typeof runAnalysisSchema>;

/** Renaming a topic the model named badly. Both fields are optional edits. */
export const updateTopicSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, { error: "Enter a topic name" })
      .max(MAX_TOPIC_LABEL_CHARS, { error: `Keep topic names under ${MAX_TOPIC_LABEL_CHARS} characters` }),
    summary: z
      .union([z.string().trim().max(MAX_TOPIC_SUMMARY_CHARS, { error: "That summary is too long" }), z.null()])
      .transform((value) => (value && value.length > 0 ? value : null)),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: "Nothing to update" });

export type UpdateTopicInput = z.input<typeof updateTopicSchema>;

/**
 * Drafting a knowledge article from a topic.
 *
 * `collectionId` is where the draft is filed. Null means Unorganized, which is
 * the knowledge feature's word for "not reachable by any agent yet" - the right
 * default for text a model wrote and nobody has read.
 */
export const draftArticleSchema = z.object({
  collectionId: z.union([z.uuid(), z.null()]).default(null),
});

export type DraftArticleInput = z.input<typeof draftArticleSchema>;
