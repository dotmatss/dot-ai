import { z } from "zod";

import { CHATBOT_STATUSES } from "@/features/chatbots/types";

export const chatbotStatusSchema = z.enum(CHATBOT_STATUSES);

export const chatbotModelConfigSchema = z.object({
  model: z.string().trim().max(100).nullable(),
  temperature: z.coerce.number().min(0, { error: "Minimum is 0" }).max(2, { error: "Maximum is 2" }),
  maxTokens: z.coerce.number().int().min(64, { error: "Minimum is 64" }).max(8192, { error: "Maximum is 8192" }),
});

export const chatbotAppearanceSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, { error: "Use a hex color like #111111" }),
  theme: z.enum(["light", "dark"]),
  position: z.enum(["bottom-right", "bottom-left"]),
  launcherLabel: z.string().trim().min(1, { error: "Enter a label" }).max(40),
  avatarUrl: z.union([z.url({ error: "Enter a valid URL" }), z.literal("")]).transform((v) => (v === "" ? null : v)).nullable(),
  showBranding: z.boolean(),
});

const HOSTNAME_PATTERN = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$|^localhost(:\d{1,5})?$/i;

export const allowedDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
  .pipe(z.string().regex(HOSTNAME_PATTERN, { error: "Enter a hostname such as example.com or *.example.com" }));

export const createChatbotSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter a name" }).max(80, { error: "Keep the name under 80 characters" }),
  description: z.string().trim().max(280, { error: "Keep the description under 280 characters" }).optional(),
});

export type CreateChatbotInput = z.infer<typeof createChatbotSchema>;

export const updateChatbotSchema = z
  .object({
    name: z.string().trim().min(2, { error: "Enter a name" }).max(80),
    description: z.string().trim().max(280).nullable(),
    instructions: z.string().max(20_000, { error: "Instructions are limited to 20,000 characters" }),
    welcomeMessage: z.string().trim().min(1, { error: "Enter a welcome message" }).max(500),
    status: chatbotStatusSchema,
    modelConfig: chatbotModelConfigSchema,
    /**
     * The agent this chatbot deploys. `null` unlinks it and returns the chatbot
     * to its own instructions, model and collections, all of which are kept.
     * Ownership and lifecycle are checked server-side; a uuid here proves
     * nothing about who may use it.
     */
    agentId: z.uuid().nullable(),
    appearance: chatbotAppearanceSchema,
    allowedDomains: z.array(allowedDomainSchema).max(50, { error: "Up to 50 domains" }),
    collectionIds: z.array(z.uuid()).max(20),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: "Nothing to update" });

export type UpdateChatbotInput = z.input<typeof updateChatbotSchema>;

export const chatbotListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  status: chatbotStatusSchema.optional(),
});

export const playgroundChatSchema = z.object({
  conversationId: z.uuid().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(8000),
      }),
    )
    .min(1)
    .max(60),
});

export type PlaygroundChatInput = z.infer<typeof playgroundChatSchema>;

/** Form-facing schema for the instructions tab (flattened model config). */
export const chatbotInstructionsFormSchema = z.object({
  instructions: z.string().max(20_000),
  welcomeMessage: z.string().trim().min(1, { error: "Enter a welcome message" }).max(500),
  model: z.string(),
  temperature: z.number({ error: "Enter a number" }).min(0, { error: "Minimum is 0" }).max(2, { error: "Maximum is 2" }),
  maxTokens: z.number({ error: "Enter a number" }).int().min(64, { error: "Minimum is 64" }).max(8192, { error: "Maximum is 8192" }),
});

export type ChatbotInstructionsFormValues = z.infer<typeof chatbotInstructionsFormSchema>;

export const chatbotSettingsFormSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter a name" }).max(80),
  description: z.string().trim().max(280),
});

export type ChatbotSettingsFormValues = z.infer<typeof chatbotSettingsFormSchema>;
