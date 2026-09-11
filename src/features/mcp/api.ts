import type { SetMcpGrantsInput, CreateMcpServerInput, UpdateMcpServerInput } from "@/features/mcp/schemas";
import type { McpServerSummary, McpToolCall, McpToolView } from "@/features/mcp/types";
import type { McpDiscoveryOutcome, McpProbeOutcome } from "@/features/mcp/server/mcp-service";
import type { AttachableMcpTool } from "@/features/mcp/server/agent-mcp";
import { apiFetch } from "@/lib/api/http";

const mcp = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/mcp`;
const base = (workspaceSlug: string) => `${mcp(workspaceSlug)}/servers`;
const server = (workspaceSlug: string, serverId: string) => `${base(workspaceSlug)}/${serverId}`;

/**
 * Client-side API surface for MCP configuration.
 *
 * Configuration and review. There is no client path that *starts* a tool call:
 * a call originates from an agent turn, and the only thing a person does from
 * here is decide one that stopped for them.
 */
export const mcpApi = {
  listServers: (workspaceSlug: string) => apiFetch<McpServerSummary[]>(base(workspaceSlug)),
  getServer: (workspaceSlug: string, serverId: string) => apiFetch<McpServerSummary>(server(workspaceSlug, serverId)),
  createServer: (workspaceSlug: string, input: CreateMcpServerInput) =>
    apiFetch<McpServerSummary>(base(workspaceSlug), { method: "POST", json: input }),
  updateServer: (workspaceSlug: string, serverId: string, input: UpdateMcpServerInput) =>
    apiFetch<McpServerSummary>(server(workspaceSlug, serverId), { method: "PATCH", json: input }),
  deleteServer: (workspaceSlug: string, serverId: string) =>
    apiFetch<void>(server(workspaceSlug, serverId), { method: "DELETE" }),

  probe: (workspaceSlug: string, serverId: string) =>
    apiFetch<McpProbeOutcome>(`${server(workspaceSlug, serverId)}/probe`, { method: "POST" }),
  discover: (workspaceSlug: string, serverId: string) =>
    apiFetch<McpDiscoveryOutcome>(`${server(workspaceSlug, serverId)}/discover`, { method: "POST" }),

  listTools: (workspaceSlug: string, serverId: string) => apiFetch<McpToolView[]>(`${server(workspaceSlug, serverId)}/tools`),
  setGrants: (workspaceSlug: string, serverId: string, input: SetMcpGrantsInput) =>
    apiFetch<McpToolView[]>(`${server(workspaceSlug, serverId)}/grants`, { method: "PUT", json: input }),

  authorize: (workspaceSlug: string, serverId: string) =>
    apiFetch<{ authorizationUrl: string }>(`${server(workspaceSlug, serverId)}/authorize`, { method: "POST" }),
  revokeAuthorization: (workspaceSlug: string, serverId: string) =>
    apiFetch<{ revoked: boolean }>(`${server(workspaceSlug, serverId)}/authorize`, { method: "DELETE" }),

  listAttachable: (workspaceSlug: string) => apiFetch<AttachableMcpTool[]>(`${mcp(workspaceSlug)}/attachable`),

  listApprovals: (workspaceSlug: string) => apiFetch<McpToolCall[]>(`${mcp(workspaceSlug)}/approvals`),
  decideCall: (workspaceSlug: string, callId: string, decision: "approve" | "deny") =>
    apiFetch<McpToolCall>(`${mcp(workspaceSlug)}/approvals/${callId}`, { method: "POST", json: { decision } }),
  listCalls: (workspaceSlug: string, limit = 50) => apiFetch<McpToolCall[]>(`${mcp(workspaceSlug)}/calls?limit=${limit}`),
};
