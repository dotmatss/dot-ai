import type { DelegationConfig } from "@/features/agents/delegation-limits";
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
  /**
   * Dynamic delegation: this agent may hand a task to explicitly granted agents
   * in its own workspace while it runs. A capability, not a kind of agent - the
   * same agent in every other way, and still usable alone or in a workflow.
   */
  canDelegate: boolean;
  /** Live grants. 0 for a standard agent, and for a supervisor configured with none. */
  delegateCount: number;
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
  /** Child agents this supervisor may delegate to. Empty for a standard agent. */
  delegateIds: string[];
  /** Parsed and clamped from `delegation_config`; never the raw column. */
  delegationConfig: DelegationConfig;
}

/** One agent a supervisor may be granted, as the configuration UI sees it. */
export interface DelegationTarget {
  id: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  /** The grant exists but is switched off; refused exactly like a missing one. */
  enabled: boolean;
  /** That agent may itself delegate, so granting it can add a level of depth. */
  canDelegate: boolean;
}

/** An agent a supervisor could be granted, for the picker. */
export interface DelegationCandidate {
  id: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  canDelegate: boolean;
  granted: boolean;
  enabled: boolean;
}

export const AGENT_EXECUTION_STATUSES = ["running", "succeeded", "failed", "timed_out", "refused"] as const;
export type AgentExecutionStatus = (typeof AGENT_EXECUTION_STATUSES)[number];

/**
 * What a supervisor receives from a child.
 *
 * Deliberately narrow. There is no field here for the child's prompt, tool
 * calls, retrieved passages, MCP arguments or configuration, because none of
 * that may cross the boundary between two agents.
 */
export interface AgentExecutionResult {
  executionId: string;
  status: AgentExecutionStatus;
  output: string | null;
  error: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  /** The child asked for something a person must approve before it happens. */
  requiresApproval: boolean;
}

/** One node of an execution tree, for tracing. Never carries reasoning. */
export interface AgentExecutionNode {
  id: string;
  agentId: string | null;
  parentExecutionId: string | null;
  depth: number;
  status: AgentExecutionStatus;
  inputTask: string | null;
  error: string | null;
  requiresApproval: boolean;
  inputTokens: number;
  outputTokens: number;
  startedAt: string;
  finishedAt: string | null;
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
