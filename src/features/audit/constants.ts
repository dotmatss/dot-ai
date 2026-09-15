/**
 * Display metadata for the audit log.
 *
 * Both maps are lookups with a fallback, never an allowlist: `entity_type` and
 * `action` are free text columns written by services across the app, so a value
 * added by a feature that does not know this file exists must still render.
 * `humanize()` is what turns `mcp_tool_call` into "MCP tool call" when nothing
 * is mapped.
 */

const ENTITY_LABELS: Record<string, string> = {
  workspace: "Workspace",
  organization_member: "Member",
  organization_invitation: "Invitation",
  chatbot: "Chatbot",
  agent: "Agent",
  workflow: "Workflow",
  workflow_run: "Workflow run",
  knowledge_collection: "Collection",
  knowledge_base: "Collection",
  knowledge_source: "Knowledge source",
  contact: "Contact",
  conversation: "Conversation",
  integration: "Integration",
  api_key: "API key",
  mcp_server: "MCP server",
  mcp_tool: "MCP tool",
  mcp_tool_call: "MCP tool call",
};

const ACRONYMS: Record<string, string> = { mcp: "MCP", crm: "CRM", api: "API", ai: "AI", url: "URL" };

/** `mcp_tool_call` -> "MCP tool call"; `role:admin` -> "Role: admin". */
export function humanize(value: string): string {
  const [head, ...rest] = value.split(":");
  const words = (head ?? value).split(/[_.\s]+/).filter(Boolean);
  const text = words
    .map((word, index) => {
      const acronym = ACRONYMS[word.toLowerCase()];
      if (acronym) return acronym;
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
  return rest.length > 0 ? `${text}: ${rest.join(":")}` : text;
}

export function entityTypeLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? humanize(entityType);
}

export function actionLabel(action: string): string {
  return humanize(action);
}

/** Page size for the audit table. Deliberately larger than a list of records. */
export const AUDIT_PAGE_SIZE = 25;
