import { z } from "zod";

import { DEMO_MAX_HISTORY, DEMO_MAX_MESSAGE_LENGTH } from "@/features/public-chatbot/constants";

/**
 * Request contract for the public demo endpoint.
 *
 * Deliberately minimal. There is no chatbot id, no workspace, no embed key and
 * no conversation id, because the demo has none of those things - and a field
 * that does not exist cannot be used to reach another tenant's data.
 */
export const demoChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(DEMO_MAX_MESSAGE_LENGTH),
      }),
    )
    .min(1)
    .max(DEMO_MAX_HISTORY * 2),
});

export type DemoChatInput = z.infer<typeof demoChatSchema>;
