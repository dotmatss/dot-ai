import { z } from "zod";

import { CONTACT_SEARCH_DEFAULT_LIMIT } from "@/features/conversations/constants";
import { CONVERSATION_CHANNELS, CONVERSATION_STATUSES } from "@/features/conversations/types";

export const conversationStatusSchema = z.enum(CONVERSATION_STATUSES);
export const conversationChannelSchema = z.enum(CONVERSATION_CHANNELS);

/** "me" is resolved server-side to the authenticated user so URLs stay shareable. */
export const assignedToFilterSchema = z.union([z.literal("me"), z.uuid()]);

export const conversationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  status: conversationStatusSchema.optional(),
  channel: conversationChannelSchema.optional(),
  chatbotId: z.uuid().optional(),
  agentId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  assignedTo: assignedToFilterSchema.optional(),
});

export type ConversationListQuery = z.output<typeof conversationListQuerySchema>;

export const updateConversationSchema = z
  .object({
    status: conversationStatusSchema,
    /** Link (uuid) or unlink (null) the CRM contact. */
    contactId: z.uuid().nullable(),
    /** Assign to a workspace member (uuid) or clear the assignment (null). */
    assignedTo: z.uuid().nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: "Nothing to update" });

export type UpdateConversationInput = z.input<typeof updateConversationSchema>;

export const contactSearchQuerySchema = z.object({
  q: z.string().trim().min(1, { error: "Enter a name or email" }).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(CONTACT_SEARCH_DEFAULT_LIMIT),
});

export const humanReplySchema = z.object({
  content: z.string().trim().min(1, { error: "Enter a message" }).max(8000, { error: "Keep replies under 8,000 characters" }),
});

export type HumanReplyInput = z.infer<typeof humanReplySchema>;
