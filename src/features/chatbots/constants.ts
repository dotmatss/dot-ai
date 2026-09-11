import type { BadgeTone } from "@/components/ui/app-badge";
import type { ChatbotAppearance, ChatbotModelConfig, ChatbotStatus } from "@/features/chatbots/types";

export const CHATBOT_STATUS_META: Record<ChatbotStatus, { label: string; tone: BadgeTone; description: string }> = {
  draft: { label: "Draft", tone: "neutral", description: "Not yet available to visitors." },
  active: { label: "Active", tone: "success", description: "Serving conversations on allowed domains." },
  paused: { label: "Paused", tone: "warning", description: "Temporarily not responding to visitors." },
  archived: { label: "Archived", tone: "neutral", description: "Hidden from lists and disabled." },
};

export const DEFAULT_MODEL_CONFIG: ChatbotModelConfig = {
  model: null,
  temperature: 0.3,
  maxTokens: 1024,
};

export const DEFAULT_APPEARANCE: ChatbotAppearance = {
  primaryColor: "#111111",
  theme: "light",
  position: "bottom-right",
  launcherLabel: "Chat with us",
  avatarUrl: null,
  showBranding: true,
};

/**
 * Model choices exposed in the UI. Identifiers are passed through the AI
 * gateway unchanged; the gateway (Cloudflare AI Gateway) maps them to the
 * configured upstream provider, keeping the frontend provider-agnostic.
 */
export const MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Workspace default" },
  { value: "fast", label: "Fast (lower cost)" },
  { value: "balanced", label: "Balanced" },
  { value: "quality", label: "Highest quality" },
];

export const DEFAULT_INSTRUCTIONS_PLACEHOLDER = `You are a helpful support assistant for Acme.
- Answer using the connected knowledge collections when possible and cite sources.
- Keep answers concise and friendly.
- If you are unsure, ask a clarifying question or offer to connect the visitor with a human.`;
