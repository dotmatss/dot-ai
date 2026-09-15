import { z } from "zod";

import { playgroundChatSchema } from "@/features/chatbots/schemas";

export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: "Name the key so you can recognise it later" })
    .max(60, { error: "Keep the name under 60 characters" }),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export const apiKeyListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["active", "revoked"]).optional(),
});

/**
 * Body of the public, API-key authenticated chat endpoint. Built on the
 * playground schema so third-party callers and the widget share one contract.
 *
 * It lives here rather than with the chatbots feature because this is the
 * inbound developer surface: the endpoint is reached with an API key issued on
 * this feature's page, and the two have to agree about what a caller may send.
 */
export const publicChatSchema = playgroundChatSchema.extend({
  chatbotId: z.uuid({ error: "chatbotId must be a chatbot UUID" }),
});

export type PublicChatInput = z.infer<typeof publicChatSchema>;
