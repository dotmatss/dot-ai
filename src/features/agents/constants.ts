import type { BadgeTone } from "@/components/ui/app-badge";
import type { AgentMemoryConfig, AgentModelConfig, AgentOutputSchema, AgentStatus, AgentToolCallStatus } from "@/features/agents/types";

export const AGENT_STATUS_META: Record<AgentStatus, { label: string; tone: BadgeTone; description: string }> = {
  draft: { label: "Draft", tone: "neutral", description: "Being configured; not yet available to run." },
  active: { label: "Active", tone: "success", description: "Available to workflows, the API and the playground." },
  paused: { label: "Paused", tone: "warning", description: "Temporarily not accepting new tasks." },
  archived: { label: "Archived", tone: "neutral", description: "Hidden from lists and disabled." },
};

export const DEFAULT_MODEL_CONFIG: AgentModelConfig = {
  model: null,
  temperature: 0.2,
  maxTokens: 2048,
};

export const DEFAULT_MEMORY_CONFIG: AgentMemoryConfig = {
  enabled: true,
  windowMessages: 20,
  summarize: false,
};

export const MEMORY_WINDOW_LIMITS = { min: 2, max: 200 } as const;

export const INSTRUCTIONS_MAX_LENGTH = 20_000;
export const OUTPUT_SCHEMA_MAX_LENGTH = 20_000;

/**
 * Model choices exposed in the UI. Identifiers are passed through the AI
 * gateway unchanged so the frontend stays provider-agnostic. Kept local to the
 * feature (mirrors the chatbots list) until a shared model catalogue exists.
 */
export const MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Workspace default" },
  { value: "fast", label: "Fast (lower cost)" },
  { value: "balanced", label: "Balanced" },
  { value: "quality", label: "Highest quality" },
];

export const DEFAULT_INSTRUCTIONS_PLACEHOLDER = `You are an operations agent for Acme.
- Work through the task step by step and use tools when they help.
- Prefer the connected knowledge base for product facts and cite sources.
- Ask before taking irreversible actions such as sending email.
- Report what you did and what still needs a human.`;

export const EXAMPLE_OUTPUT_SCHEMA: AgentOutputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One-paragraph summary of the outcome." },
    nextSteps: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["summary"],
};

export const TOOL_CALL_STATUS_META: Record<AgentToolCallStatus, { label: string; tone: BadgeTone }> = {
  executed: { label: "Executed", tone: "success" },
  simulated: { label: "Simulated", tone: "info" },
  approval_required: { label: "Approval required", tone: "warning" },
  unavailable: { label: "Not enabled", tone: "neutral" },
  unknown_tool: { label: "Unknown tool", tone: "danger" },
};
