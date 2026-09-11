import { BookOpen, Globe, Mail, UserPlus, Webhook, Workflow, type LucideIcon } from "lucide-react";
import { z } from "zod";

import { AGENT_TOOL_IDS, type AgentToolCallStatus, type AgentToolId, type AgentToolSetting } from "@/features/agents/types";

/**
 * Declarative catalogue of the tools an agent can be granted.
 *
 * Entries describe capability and configuration only: they never import from
 * other features. Tools that act on workflows or CRM records reference those
 * domains by id so this registry stays a leaf module and the owning features
 * can evolve independently.
 */

export const AGENT_TOOL_CATEGORIES = ["research", "knowledge", "integration", "crm", "automation", "communication"] as const;
export type AgentToolCategory = (typeof AGENT_TOOL_CATEGORIES)[number];

export const AGENT_TOOL_CATEGORY_LABELS: Record<AgentToolCategory, string> = {
  research: "Research",
  knowledge: "Knowledge",
  integration: "Integration",
  crm: "CRM",
  automation: "Automation",
  communication: "Communication",
};

/**
 * Render descriptor for one configuration input. Validation always comes from
 * `configSchema`; this only says how to present the field, because deriving
 * labels and control types from a Zod schema at runtime is brittle.
 */
export interface AgentToolConfigField {
  key: string;
  label: string;
  kind: "text" | "number" | "switch" | "select";
  description?: string;
  placeholder?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
}

export interface AgentToolDefinition {
  readonly id: AgentToolId;
  readonly name: string;
  readonly description: string;
  /** One line describing what the agent can do once this tool is enabled. */
  readonly capability: string;
  readonly category: AgentToolCategory;
  readonly icon: LucideIcon;
  readonly configSchema: z.ZodType;
  readonly defaultConfig: Record<string, unknown>;
  readonly configFields: readonly AgentToolConfigField[];
  /** Tools with side effects outside the workspace default to human approval. */
  readonly requiresApprovalByDefault: boolean;
}

const optionalUrl = z.union([z.literal(""), z.url({ error: "Enter a valid URL" })]);

const webSearchConfigSchema = z.object({
  maxResults: z.coerce.number().int().min(1, { error: "Minimum is 1" }).max(10, { error: "Maximum is 10" }).default(5),
  region: z.enum(["global", "us", "eu", "apac"]).default("global"),
});

const httpRequestConfigSchema = z.object({
  baseUrl: optionalUrl.default(""),
  timeoutMs: z.coerce.number().int().min(1000, { error: "Minimum is 1000" }).max(30_000, { error: "Maximum is 30000" }).default(10_000),
  allowWrites: z.boolean().default(false),
});

const knowledgeSearchConfigSchema = z.object({
  maxChunks: z.coerce.number().int().min(1, { error: "Minimum is 1" }).max(10, { error: "Maximum is 10" }).default(4),
  requireCitations: z.boolean().default(true),
});

const createContactConfigSchema = z.object({
  dedupeByEmail: z.boolean().default(true),
  defaultTag: z.string().trim().max(40, { error: "Keep the tag under 40 characters" }).default(""),
});

const runWorkflowConfigSchema = z.object({
  // Workflows are owned by another feature; only the id crosses the boundary.
  workflowId: z.union([z.literal(""), z.uuid({ error: "Enter a workflow ID" })]).default(""),
  waitForCompletion: z.boolean().default(false),
});

const sendEmailConfigSchema = z.object({
  fromName: z.string().trim().max(60, { error: "Keep the name under 60 characters" }).default(""),
  replyTo: z.union([z.literal(""), z.email({ error: "Enter a valid email address" })]).default(""),
  maxPerTurn: z.coerce.number().int().min(1, { error: "Minimum is 1" }).max(10, { error: "Maximum is 10" }).default(1),
});

export const AGENT_TOOLS: Record<AgentToolId, AgentToolDefinition> = {
  web_search: {
    id: "web_search",
    name: "Web search",
    description: "Query the public web through the configured search provider.",
    capability: "Look up current information online and quote the pages it used.",
    category: "research",
    icon: Globe,
    configSchema: webSearchConfigSchema,
    defaultConfig: { maxResults: 5, region: "global" },
    configFields: [
      { key: "maxResults", label: "Results per search", kind: "number", min: 1, max: 10, step: 1, description: "How many pages to consider." },
      {
        key: "region",
        label: "Region bias",
        kind: "select",
        options: [
          { value: "global", label: "Global" },
          { value: "us", label: "United States" },
          { value: "eu", label: "Europe" },
          { value: "apac", label: "Asia Pacific" },
        ],
      },
    ],
    requiresApprovalByDefault: false,
  },
  http_request: {
    id: "http_request",
    name: "HTTP request",
    description: "Call an HTTP endpoint and read the response body.",
    capability: "Fetch or push data to an approved API and use the JSON it returns.",
    category: "integration",
    icon: Webhook,
    configSchema: httpRequestConfigSchema,
    defaultConfig: { baseUrl: "", timeoutMs: 10_000, allowWrites: false },
    configFields: [
      {
        key: "baseUrl",
        label: "Base URL",
        kind: "text",
        placeholder: "https://api.example.com",
        description: "Requests are restricted to this origin. Leave empty to require an explicit URL per call.",
      },
      { key: "timeoutMs", label: "Timeout (ms)", kind: "number", min: 1000, max: 30_000, step: 500 },
      { key: "allowWrites", label: "Allow POST, PUT and DELETE", kind: "switch", description: "Off means read-only GET requests." },
    ],
    requiresApprovalByDefault: true,
  },
  knowledge_search: {
    id: "knowledge_search",
    name: "Knowledge search",
    description: "Search the collections attached to this agent.",
    capability: "Answer from your own documents and cite the matching passages.",
    category: "knowledge",
    icon: BookOpen,
    configSchema: knowledgeSearchConfigSchema,
    defaultConfig: { maxChunks: 4, requireCitations: true },
    configFields: [
      { key: "maxChunks", label: "Passages per search", kind: "number", min: 1, max: 10, step: 1 },
      { key: "requireCitations", label: "Require citations", kind: "switch", description: "Answers must reference the passages they used." },
    ],
    requiresApprovalByDefault: false,
  },
  create_contact: {
    id: "create_contact",
    name: "Create contact",
    description: "Add a person to the CRM with the details gathered in the conversation.",
    capability: "Capture a new lead as a contact record without leaving the conversation.",
    category: "crm",
    icon: UserPlus,
    configSchema: createContactConfigSchema,
    defaultConfig: { dedupeByEmail: true, defaultTag: "" },
    configFields: [
      { key: "dedupeByEmail", label: "Merge duplicates by email", kind: "switch", description: "Update the existing contact instead of creating a second one." },
      { key: "defaultTag", label: "Default tag", kind: "text", placeholder: "agent-captured" },
    ],
    requiresApprovalByDefault: false,
  },
  run_workflow: {
    id: "run_workflow",
    name: "Run workflow",
    description: "Start one of this workspace's workflows with structured input.",
    capability: "Hand a task to an automation you already built and report the outcome.",
    category: "automation",
    icon: Workflow,
    configSchema: runWorkflowConfigSchema,
    defaultConfig: { workflowId: "", waitForCompletion: false },
    configFields: [
      { key: "workflowId", label: "Workflow ID", kind: "text", placeholder: "00000000-0000-0000-0000-000000000000", description: "Copy the ID from the workflow's settings tab." },
      { key: "waitForCompletion", label: "Wait for the run to finish", kind: "switch", description: "Off starts the run and continues immediately." },
    ],
    requiresApprovalByDefault: true,
  },
  send_email: {
    id: "send_email",
    name: "Send email",
    description: "Send an email through the workspace's configured sender.",
    capability: "Draft and deliver a message to a person it is talking about.",
    category: "communication",
    icon: Mail,
    configSchema: sendEmailConfigSchema,
    defaultConfig: { fromName: "", replyTo: "", maxPerTurn: 1 },
    configFields: [
      { key: "fromName", label: "From name", kind: "text", placeholder: "Acme Support" },
      { key: "replyTo", label: "Reply-to address", kind: "text", placeholder: "support@example.com" },
      { key: "maxPerTurn", label: "Emails per turn", kind: "number", min: 1, max: 10, step: 1 },
    ],
    requiresApprovalByDefault: true,
  },
};

/** Registry in display order; the id list is the single source of ordering. */
export const AGENT_TOOL_LIST: readonly AgentToolDefinition[] = AGENT_TOOL_IDS.map((id) => AGENT_TOOLS[id]);

export function isAgentToolId(value: unknown): value is AgentToolId {
  return typeof value === "string" && (AGENT_TOOL_IDS as readonly string[]).includes(value);
}

export function findAgentTool(toolId: string): AgentToolDefinition | null {
  return isAgentToolId(toolId) ? AGENT_TOOLS[toolId] : null;
}

export function defaultToolSetting(toolId: AgentToolId): AgentToolSetting {
  const tool = AGENT_TOOLS[toolId];
  return {
    toolId,
    enabled: false,
    config: { ...tool.defaultConfig },
    requiresApproval: tool.requiresApprovalByDefault,
  };
}

/**
 * Coerces the `agents.tools` jsonb column into domain settings. Rows can predate
 * a registry change, so unknown ids are dropped and missing config keys fall
 * back to the tool's defaults rather than failing the read.
 */
export function normalizeToolSettings(value: unknown): AgentToolSetting[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<AgentToolId, AgentToolSetting>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    if (!isAgentToolId(raw.toolId)) continue;
    const tool = AGENT_TOOLS[raw.toolId];
    const parsed = tool.configSchema.safeParse(raw.config ?? {});
    byId.set(raw.toolId, {
      toolId: raw.toolId,
      enabled: raw.enabled === true,
      config: parsed.success ? (parsed.data as Record<string, unknown>) : { ...tool.defaultConfig },
      requiresApproval: typeof raw.requiresApproval === "boolean" ? raw.requiresApproval : tool.requiresApprovalByDefault,
    });
  }
  return AGENT_TOOL_IDS.filter((id) => byId.has(id)).map((id) => byId.get(id) as AgentToolSetting);
}

/** Settings for every tool in the registry, filling gaps with defaults. Used by the tools UI. */
export function toolSettingsForForm(settings: readonly AgentToolSetting[]): AgentToolSetting[] {
  return AGENT_TOOL_IDS.map((id) => settings.find((setting) => setting.toolId === id) ?? defaultToolSetting(id));
}

export function enabledToolSettings(settings: readonly AgentToolSetting[]): Array<{ definition: AgentToolDefinition; setting: AgentToolSetting }> {
  return settings
    .filter((setting) => setting.enabled)
    .map((setting) => ({ definition: AGENT_TOOLS[setting.toolId], setting }));
}

export interface ResolvedAgentToolCall {
  toolId: string;
  status: AgentToolCallStatus;
  reason: string;
}

/**
 * Decides what happens to a tool call the model asked for. Nothing is ever
 * executed here: agents surface intent so a human can review it, so the answer
 * is always a status plus an explanation.
 */
export function resolveAgentToolCall(input: {
  name: string;
  tools: readonly AgentToolSetting[];
  agentRequiresApproval: boolean;
}): ResolvedAgentToolCall {
  const definition = findAgentTool(input.name);
  if (!definition) {
    return { toolId: input.name, status: "unknown_tool", reason: `“${input.name}” is not a tool this platform provides.` };
  }
  const setting = input.tools.find((entry) => entry.toolId === definition.id);
  if (!setting?.enabled) {
    return { toolId: definition.id, status: "unavailable", reason: `${definition.name} is not enabled for this agent.` };
  }
  if (input.agentRequiresApproval || setting.requiresApproval) {
    const scope = input.agentRequiresApproval ? "This agent pauses for approval on every tool call" : `${definition.name} is set to require approval`;
    return { toolId: definition.id, status: "approval_required", reason: `${scope}, so the call is waiting for a person to approve it.` };
  }
  return {
    toolId: definition.id,
    status: "simulated",
    reason: `${definition.name} is enabled. Tool execution is not connected yet, so the call was recorded instead of run.`,
  };
}
