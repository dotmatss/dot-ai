export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

const RANK: Record<MemberRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export const MEMBER_ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: "Full access, including billing and deleting the organization.",
  admin: "Manage members, settings, integrations and all workspace resources.",
  member: "Create and edit chatbots, agents, workflows, knowledge and CRM records.",
  viewer: "Read-only access to dashboards, conversations and records.",
};

/** True when `role` grants at least the privileges of `minimum`. */
export function hasMinimumRole(role: MemberRole, minimum: MemberRole): boolean {
  return RANK[role] >= RANK[minimum];
}

export function canEdit(role: MemberRole): boolean {
  return hasMinimumRole(role, "member");
}

export function canManage(role: MemberRole): boolean {
  return hasMinimumRole(role, "admin");
}
