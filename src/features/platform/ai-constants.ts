import type { BadgeTone } from "@/components/ui/app-badge";
import type { AiCapability, AiModelStatus, AiProviderKind } from "@/features/platform/ai-types";

export const AI_PROVIDER_KIND_LABELS: Record<AiProviderKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
  azure_openai: "Azure OpenAI",
  gateway: "AI Gateway",
  custom: "Custom",
};

/**
 * Capability labels, in the order an operator reasons about them: what kind of
 * work the model does first, then what it can handle while doing it.
 */
export const AI_CAPABILITY_LABELS: Record<AiCapability, string> = {
  chat: "Chat",
  agent: "Agents",
  tool_calling: "Tool calling",
  structured_output: "Structured output",
  vision: "Vision",
  reranking: "Reranking",
};

export const AI_MODEL_STATUS_META: Record<AiModelStatus, { label: string; tone: BadgeTone; description: string }> = {
  active: { label: "Active", tone: "success", description: "Offered wherever the availability list allows." },
  deprecated: {
    label: "Deprecated",
    tone: "warning",
    description: "Still resolvable for existing configurations, but should not be chosen for new ones.",
  },
  disabled: {
    label: "Disabled",
    tone: "danger",
    description: "Not offered. Existing configurations naming it must be migrated before it is removed.",
  },
};

/**
 * Formats USD per million tokens.
 *
 * Null is rendered as an em dash and explicitly NOT as "$0.00": "we have not
 * recorded a price" and "this is free" are different facts, and a cost view
 * that conflates them under-reports spend.
 */
export function formatCostPerMtok(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toFixed(2)}`;
}
