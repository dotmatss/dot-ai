import { MEMBER_ROLES, type MemberRole } from "@/features/workspaces/roles";

/**
 * What each role may actually do, as one table.
 *
 * This is a *description* of enforcement, never the enforcement itself. The
 * floors that matter are the `minimumRole` arguments on route handlers and the
 * `requireWorkspaceAccess` calls on pages; this table restates them so the
 * Roles & permissions page can be rendered from the same source rather than
 * hand-written prose that rots the first time a floor changes.
 *
 * `enforcedBy` names the route file whose handler carries the floor, and
 * `tests/unit/settings-permissions.test.ts` reads the file and fails if the two
 * disagree. A capability with no route file is one the database or the page
 * layer enforces, and it says so with `enforcedBy: null`.
 */

export const CAPABILITY_AREAS = ["organization", "workspace", "integrations", "developer"] as const;
export type CapabilityArea = (typeof CAPABILITY_AREAS)[number];

export const CAPABILITY_AREA_LABELS: Record<CapabilityArea, string> = {
  organization: "Organization",
  workspace: "Workspace",
  integrations: "Integrations and tools",
  developer: "Developer surfaces",
};

export interface Capability {
  key: string;
  area: CapabilityArea;
  label: string;
  /** The floor the server enforces. `viewer` means everyone with access. */
  minimumRole: MemberRole;
  /** Route file, relative to src/app/api/v1/w/[workspaceSlug]/, that carries the floor. */
  enforcedBy: string | null;
}

export const CAPABILITIES: ReadonlyArray<Capability> = [
  // Organization ------------------------------------------------------------
  {
    key: "view_members",
    area: "organization",
    label: "See who is in the organization",
    minimumRole: "viewer",
    enforcedBy: null,
  },
  {
    key: "invite_members",
    area: "organization",
    label: "Invite people and revoke invitations",
    minimumRole: "admin",
    enforcedBy: "settings/invitations/route.ts",
  },
  {
    key: "manage_members",
    area: "organization",
    label: "Change roles and remove members",
    minimumRole: "admin",
    enforcedBy: "settings/members/[memberUserId]/route.ts",
  },
  {
    key: "rename_workspace",
    area: "organization",
    label: "Rename the workspace",
    minimumRole: "admin",
    enforcedBy: "settings/general/route.ts",
  },
  {
    key: "view_audit_log",
    area: "organization",
    label: "Read the audit log",
    minimumRole: "admin",
    enforcedBy: "audit/route.ts",
  },
  {
    key: "view_billing",
    area: "organization",
    label: "See the plan and what it allows",
    minimumRole: "admin",
    enforcedBy: "settings/billing/route.ts",
  },
  {
    key: "manage_billing",
    area: "organization",
    label: "Change which plan this workspace is on",
    minimumRole: "owner",
    enforcedBy: "settings/billing/route.ts",
  },

  // Workspace ---------------------------------------------------------------
  {
    key: "view_workspace",
    area: "workspace",
    label: "View chatbots, agents, workflows, knowledge, conversations and CRM",
    minimumRole: "viewer",
    enforcedBy: null,
  },
  {
    key: "edit_chatbots",
    area: "workspace",
    label: "Create and edit chatbots",
    minimumRole: "member",
    enforcedBy: "chatbots/route.ts",
  },
  {
    key: "edit_agents",
    area: "workspace",
    label: "Create and edit agents",
    minimumRole: "member",
    enforcedBy: "agents/route.ts",
  },
  {
    key: "edit_workflows",
    area: "workspace",
    label: "Create, edit and run workflows",
    minimumRole: "member",
    enforcedBy: "workflows/route.ts",
  },
  {
    key: "edit_knowledge",
    area: "workspace",
    label: "Add and reprocess knowledge sources",
    minimumRole: "member",
    enforcedBy: "knowledge/sources/route.ts",
  },
  {
    key: "reply_conversations",
    area: "workspace",
    label: "Reply in conversations",
    minimumRole: "member",
    enforcedBy: "conversations/[conversationId]/reply/route.ts",
  },
  {
    key: "edit_contacts",
    area: "workspace",
    label: "Create and edit CRM contacts",
    minimumRole: "member",
    enforcedBy: "crm/contacts/route.ts",
  },
  {
    key: "delete_records",
    area: "workspace",
    label: "Delete chatbots, agents, workflows and contacts",
    minimumRole: "admin",
    enforcedBy: "chatbots/[chatbotId]/route.ts",
  },

  // Integrations and tools --------------------------------------------------
  {
    key: "connect_integrations",
    area: "integrations",
    label: "Connect an integration",
    minimumRole: "member",
    enforcedBy: "integrations/providers/[provider]/route.ts",
  },
  {
    key: "manage_api_keys",
    area: "developer",
    label: "Issue and revoke API keys",
    minimumRole: "admin",
    enforcedBy: "developer/api-keys/route.ts",
  },
  {
    key: "connect_mcp_servers",
    area: "integrations",
    label: "Connect an MCP server",
    minimumRole: "admin",
    enforcedBy: "mcp/servers/route.ts",
  },
  {
    key: "approve_mcp_tools",
    area: "integrations",
    label: "Grant MCP tools and approve tool calls",
    minimumRole: "admin",
    enforcedBy: "mcp/approvals/[callId]/route.ts",
  },
  {
    key: "view_mcp_calls",
    area: "integrations",
    label: "Read the MCP tool-call log",
    minimumRole: "admin",
    enforcedBy: "mcp/calls/route.ts",
  },
];

/** Capabilities grouped for rendering, in the order the areas are declared. */
export function capabilitiesByArea(): Array<{ area: CapabilityArea; label: string; capabilities: Capability[] }> {
  return CAPABILITY_AREAS.map((area) => ({
    area,
    label: CAPABILITY_AREA_LABELS[area],
    capabilities: CAPABILITIES.filter((capability) => capability.area === area),
  }));
}

/** Roles in the order the matrix shows them: most privileged first. */
export const CAPABILITY_ROLE_ORDER: ReadonlyArray<MemberRole> = MEMBER_ROLES;
