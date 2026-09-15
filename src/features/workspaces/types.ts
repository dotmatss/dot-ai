import type { OrganizationStatus } from "@/features/platform/types";
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
  /**
   * Lifecycle owned by the PLATFORM plane, not by the organization (0023).
   *
   * Lives on the membership rather than on `OrganizationSummary` because that
   * shape is also a display/picker type - a form listing organizations to
   * choose between has no use for a suspension state, and making it carry one
   * would push a platform concern into four unrelated call sites. This is a
   * property of whether THIS membership currently grants access, which is
   * exactly what a membership models.
   *
   * `requireWorkspaceAccess` and `requireApiWorkspaceAccess` are the only
   * readers; carrying the value rather than folding it into the membership
   * query is what lets them explain the refusal instead of returning a 404.
   */
  organizationStatus: OrganizationStatus;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}
