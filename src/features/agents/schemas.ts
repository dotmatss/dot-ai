import { z } from "zod";

import { INSTRUCTIONS_MAX_LENGTH, MEMORY_WINDOW_LIMITS, OUTPUT_SCHEMA_MAX_LENGTH } from "@/features/agents/constants";
import { DELEGATION_CEILINGS, delegationConfigFormSchema } from "@/features/agents/delegation-limits";
import { AGENT_TOOLS } from "@/features/agents/tools/registry";
import { AGENT_STATUSES, AGENT_TOOL_IDS, type AgentToolSetting } from "@/features/agents/types";

export const agentStatusSchema = z.enum(AGENT_STATUSES);

export const agentModelConfigSchema = z.object({
  model: z.string().trim().max(100).nullable(),
  temperature: z.coerce.number().min(0, { error: "Minimum is 0" }).max(2, { error: "Maximum is 2" }),
  maxTokens: z.coerce.number().int().min(64, { error: "Minimum is 64" }).max(8192, { error: "Maximum is 8192" }),
});

export const agentMemoryConfigSchema = z.object({
  enabled: z.boolean(),
  windowMessages: z.coerce
    .number()
    .int()
    .min(MEMORY_WINDOW_LIMITS.min, { error: `Minimum is ${MEMORY_WINDOW_LIMITS.min}` })
    .max(MEMORY_WINDOW_LIMITS.max, { error: `Maximum is ${MEMORY_WINDOW_LIMITS.max}` }),
  summarize: z.boolean(),
});

/**
 * One entry of the `tools` jsonb column. The tool id must exist in the registry
 * and its config is validated by that tool's own schema, so a client cannot
 * store settings for a tool the platform does not implement.
 */
export const agentToolSettingSchema = z
  .object({
    toolId: z.enum(AGENT_TOOL_IDS, { error: "Unknown tool" }),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()).optional(),
    requiresApproval: z.boolean().optional(),
  })
  .transform((value, ctx): AgentToolSetting => {
    const tool = AGENT_TOOLS[value.toolId];
    const parsed = tool.configSchema.safeParse(value.config ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: "custom", message: issue.message, path: ["config", ...issue.path] });
      }
      return z.NEVER;
    }
    return {
      toolId: value.toolId,
      enabled: value.enabled,
      config: parsed.data as Record<string, unknown>,
      requiresApproval: value.requiresApproval ?? tool.requiresApprovalByDefault,
    };
  });

export const agentToolSettingsSchema = z
  .array(agentToolSettingSchema)
  .max(AGENT_TOOL_IDS.length, { error: "Too many tool entries" })
  .refine((settings) => new Set(settings.map((setting) => setting.toolId)).size === settings.length, {
    error: "Each tool can only be configured once",
  });

export type AgentToolSettingsInput = z.input<typeof agentToolSettingsSchema>;

/**
 * One MCP attachment in the same `tools` jsonb array.
 *
 * The tool is identified by our slug for the server plus the server's own tool
 * name, never by a database id, so a client cannot address another workspace's
 * row by guessing one. Whether the workspace actually granted the tool is not
 * asserted here: that is re-checked on every call, and a save must not fail
 * because an unrelated grant was revoked in the meantime.
 */
export const agentMcpToolSchema = z.object({
  source: z.literal("mcp"),
  serverSlug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: "That is not a server reference" }),
  toolName: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.:-]+$/, { error: "That is not a tool name" }),
  enabled: z.boolean(),
  requiresApproval: z.boolean(),
});

export const agentMcpToolsSchema = z
  .array(agentMcpToolSchema)
  .max(200, { error: "Too many MCP tools attached" })
  .refine(
    (entries) => new Set(entries.map((entry) => `${entry.serverSlug}/${entry.toolName}`)).size === entries.length,
    { error: "Each MCP tool can only be attached once" },
  );

/**
 * Structured output is edited as JSON text but stored as jsonb, so the field
 * accepts either the raw editor text or an already-parsed object and always
 * yields an object (or null when cleared).
 */
export const agentOutputSchemaField = z
  .union([z.null(), z.string().max(OUTPUT_SCHEMA_MAX_LENGTH, { error: "Schema is too large" }), z.record(z.string(), z.unknown())])
  .transform((value, ctx): Record<string, unknown> | null => {
    if (value === null) return null;
    if (typeof value !== "string") return value;
    const text = value.trim();
    if (text === "") return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter valid JSON" });
      return z.NEVER;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      ctx.addIssue({ code: "custom", message: "The schema must be a JSON object" });
      return z.NEVER;
    }
    return parsed as Record<string, unknown>;
  });

export const createAgentSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter a name" }).max(80, { error: "Keep the name under 80 characters" }),
  description: z.string().trim().max(280, { error: "Keep the description under 280 characters" }).optional(),
  /**
   * Creates the agent with the supervisor capability. It still starts with no
   * delegation grants: choosing the type is not authorizing anything.
   */
  canDelegate: z.boolean().optional(),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const updateAgentSchema = z
  .object({
    name: z.string().trim().min(2, { error: "Enter a name" }).max(80),
    description: z.string().trim().max(280).nullable(),
    instructions: z.string().max(INSTRUCTIONS_MAX_LENGTH, { error: `Instructions are limited to ${INSTRUCTIONS_MAX_LENGTH.toLocaleString()} characters` }),
    status: agentStatusSchema,
    modelConfig: agentModelConfigSchema,
    tools: agentToolSettingsSchema,
    mcpTools: agentMcpToolsSchema,
    memoryConfig: agentMemoryConfigSchema,
    outputSchema: agentOutputSchemaField,
    requiresApproval: z.boolean(),
    collectionIds: z.array(z.uuid()).max(20, { error: "Up to 20 collections" }),
    /** Supervisor capability. Granting it does not grant any child by itself. */
    canDelegate: z.boolean(),
    delegationConfig: delegationConfigFormSchema,
    /**
     * The whole grant set, replaced outright. Ownership, archived status and
     * self-delegation are all re-checked server-side; a uuid here proves
     * nothing.
     */
    delegateIds: z.array(z.uuid()).max(DELEGATION_CEILINGS.maxDelegations * 4, { error: "Too many agents" }),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: "Nothing to update" });

export type UpdateAgentInput = z.input<typeof updateAgentSchema>;

export const agentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  status: agentStatusSchema.optional(),
});

export const agentChatSchema = z.object({
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

export type AgentChatInput = z.infer<typeof agentChatSchema>;

/** Form-facing schema for the instructions tab (flattened model config). */
export const agentInstructionsFormSchema = z.object({
  instructions: z.string().max(INSTRUCTIONS_MAX_LENGTH),
  model: z.string(),
  temperature: z.number({ error: "Enter a number" }).min(0, { error: "Minimum is 0" }).max(2, { error: "Maximum is 2" }),
  maxTokens: z.number({ error: "Enter a number" }).int().min(64, { error: "Minimum is 64" }).max(8192, { error: "Maximum is 8192" }),
});

export type AgentInstructionsFormValues = z.infer<typeof agentInstructionsFormSchema>;

/** Form-facing schema for the memory & output tab; the schema stays as editor text. */
export const agentMemoryFormSchema = z.object({
  memoryEnabled: z.boolean(),
  windowMessages: z
    .number({ error: "Enter a number" })
    .int()
    .min(MEMORY_WINDOW_LIMITS.min, { error: `Minimum is ${MEMORY_WINDOW_LIMITS.min}` })
    .max(MEMORY_WINDOW_LIMITS.max, { error: `Maximum is ${MEMORY_WINDOW_LIMITS.max}` }),
  summarize: z.boolean(),
  requiresApproval: z.boolean(),
  outputSchemaText: z
    .string()
    .max(OUTPUT_SCHEMA_MAX_LENGTH, { error: "Schema is too large" })
    .refine((text) => text.trim() === "" || isJsonObjectText(text), { error: "Enter a valid JSON object" }),
});

export type AgentMemoryFormValues = z.infer<typeof agentMemoryFormSchema>;

/**
 * Form shape of the tools tab: one row per registry tool with its config
 * values flattened to scalars so React Hook Form can register each input.
 * Rows are validated against the registry so the client shows the same errors
 * the route handler would return.
 */
export const agentToolsFormSchema = z
  .object({
    tools: z.array(
      z.object({
        toolId: z.enum(AGENT_TOOL_IDS),
        enabled: z.boolean(),
        requiresApproval: z.boolean(),
        config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
      }),
    ),
  })
  .superRefine((value, ctx) => {
    value.tools.forEach((row, index) => {
      const parsed = AGENT_TOOLS[row.toolId].configSchema.safeParse(row.config);
      if (parsed.success) return;
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: "custom", message: issue.message, path: ["tools", index, "config", ...issue.path] });
      }
    });
  });

export type AgentToolsFormValues = z.infer<typeof agentToolsFormSchema>;

export const agentSettingsFormSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter a name" }).max(80),
  description: z.string().trim().max(280),
});

export type AgentSettingsFormValues = z.infer<typeof agentSettingsFormSchema>;

export function isJsonObjectText(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
