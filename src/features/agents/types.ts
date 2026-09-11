import type { AgentMcpToolAttachment } from "@/features/mcp/agent-attachment";

export const AGENT_STATUSES = ["draft", "active", "paused", "archived"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * Built-in tool identifiers. The registry in `tools/registry.ts` describes
 * each one; ids live here so domain types stay free of Zod.
 */
export const AGENT_TOOL_IDS = ["web_search", "http_request", "knowledge_search", "create_contact", "run_workflow", "send_email"] as const;
export type AgentToolId = (typeof AGENT_TOOL_IDS)[number];

export interface AgentModelConfig {
  /** Model identifier understood by the AI gateway; null uses the gateway default. */
  model: string | null;
  temperature: number;
  maxTokens: number;
}

export interface AgentMemoryConfig {
  /** When false the agent only sees the latest user message. */
  enabled: boolean;
  /** Number of most recent messages kept verbatim in the context window. */
  windowMessages: number;
  /** Condense messages that fall outside the window into a short summary. */
  summarize: boolean;
}

/** One entry of `agents.tools` (jsonb). */
export interface AgentToolSetting {
  toolId: AgentToolId;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Pause and ask a human before this tool runs. */
  requiresApproval: boolean;
}

/** A JSON Schema document describing the agent's structured reply. */
export type AgentOutputSchema = Record<string, unknown>;

export interface AgentSummary {
  id: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  conversationCount: number;
  collectionCount: number;
  enabledToolCount: number;
  requiresApproval: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Agent extends AgentSummary {
  workspaceId: string;
  instructions: string;
  modelConfig: AgentModelConfig;
  tools: AgentToolSetting[];
  /**
   * The MCP half of the same `tools` jsonb column. Two normalisers read one
   * array: this one and `normalizeToolSettings`, each ignoring the other's
   * entries. Both halves must be written back together - see `updateAgent`.
   */
  mcpTools: AgentMcpToolAttachment[];
  memoryConfig: AgentMemoryConfig;
  outputSchema: AgentOutputSchema | null;
  collectionIds: string[];
}

export interface AgentListFilters {
  q?: string;
  status?: AgentStatus;
  page?: number;
  pageSize?: number;
}

export interface AgentKnowledgeOption {
  id: string;
  name: string;
  status: string;
  sourceCount: number;
  attached: boolean;
}

export interface AgentRecentConversation {
  id: string;
  title: string | null;
  status: string;
  channel: string;
  messageCount: number;
  lastMessageAt: string | null;
}

export interface AgentOverview {
  conversationsLast7Days: number;
  conversationsPrevious7Days: number;
  messagesLast7Days: number;
  messagesPrevious7Days: number;
  recentConversations: AgentRecentConversation[];
}

/** Outcome of a tool request made by the model during an agent turn. */
export type AgentToolCallStatus = "executed" | "simulated" | "approval_required" | "unavailable" | "unknown_tool";

export interface AgentToolCallRecord {
  id: string;
  toolId: string;
  arguments: unknown;
  status: AgentToolCallStatus;
  message: string;
  result?: unknown;
}

/**
 * Wire payload of the `tool-result` SSE event emitted for a tool call. The
 * agent never executes tools, so the payload explains the decision instead of
 * carrying a result.
 */
export interface AgentToolResultPayload {
  toolId: string;
  status: AgentToolCallStatus;
  reason: string;
  arguments: unknown;
}
