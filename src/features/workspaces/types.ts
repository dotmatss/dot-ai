import type { MemberRole } from "@/features/workspaces/roles";

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
}

export interface WorkspaceSummary {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  createdAt: string;
}

/** A workspace the current user can access, with their effective role. */
export interface WorkspaceMembership {
  workspace: WorkspaceSummary;
  organization: OrganizationSummary;
  role: MemberRole;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}
