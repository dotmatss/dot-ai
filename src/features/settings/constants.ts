import type { BadgeTone } from "@/components/ui/app-badge";
import { MEMBER_ROLES, type MemberRole } from "@/features/workspaces/roles";

/** Reporting window for the Usage tab, in days. */
export const USAGE_WINDOW_DAYS = 30;

export const MAX_WORKSPACE_NAME_LENGTH = 80;
export const MAX_USER_NAME_LENGTH = 120;
export const MAX_AVATAR_URL_LENGTH = 2048;

/** Display cap for a raw user agent string; the stored value can be 512 chars. */
export const MAX_USER_AGENT_DISPLAY_LENGTH = 96;

/**
 * Monochrome by design: the role is the label, not the colour. Only `owner`
 * gets the inverted chip so the single most privileged role is scannable in a
 * long list; everything else is neutral.
 */
export const MEMBER_ROLE_BADGE: Record<MemberRole, { tone: BadgeTone; variant: "soft" | "outline" }> = {
  owner: { tone: "inverted", variant: "soft" },
  admin: { tone: "neutral", variant: "outline" },
  member: { tone: "neutral", variant: "soft" },
  viewer: { tone: "neutral", variant: "soft" },
};

/** Most privileged first: the order the members table sorts and the picker lists. */
export const MEMBER_ROLE_ORDER: ReadonlyArray<MemberRole> = MEMBER_ROLES;

/**
 * Stated plainly wherever a person would look for an invite button. There is no
 * `invitations` table in the schema, so there is nowhere to store a pending
 * invite and nothing here pretends otherwise.
 */
export const MEMBER_INVITES_UNAVAILABLE_NOTE =
  "Adding people to this organization is not available yet - this page manages the members it already has.";
