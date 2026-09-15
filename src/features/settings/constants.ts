import type { BadgeTone } from "@/components/ui/app-badge";
import type { InvitationStatus, StorageCategory } from "@/features/settings/types";
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
 * The Settings sections, with the floor each one is gated at.
 *
 * Workspace sections first, then the two that are about the person signed in -
 * Profile and Security are self-service and must never carry a floor, or a
 * member would be locked out of their own sessions list.
 *
 * The floors here mirror the ones the pages enforce with
 * `requireWorkspaceAccess`; `tests/unit/settings-permissions.test.ts` fails if
 * a tab is offered to a role its page would refuse.
 */
export const SETTINGS_TABS: ReadonlyArray<{ path: string; label: string; minimumRole?: MemberRole }> = [
  { path: "", label: "General" },
  { path: "/members", label: "Members" },
  { path: "/roles", label: "Roles" },
  { path: "/usage", label: "Usage" },
  { path: "/storage", label: "Storage" },
  { path: "/billing", label: "Billing", minimumRole: "admin" },
  { path: "/audit", label: "Audit log", minimumRole: "admin" },
  { path: "/profile", label: "Profile" },
  { path: "/security", label: "Security" },
];

/** How long an invitation link stays valid. */
export const INVITATION_EXPIRY_DAYS = 7;

/**
 * Nothing in this application sends email yet, so an invitation is delivered by
 * the person who created it. Said once, above the form, because an invite flow
 * that silently expects a mail server is worse than one that admits it does not
 * have one.
 */
export const INVITE_DELIVERY_NOTE =
  "Invitations are not emailed yet. Copy the link and send it to them yourself - it works once, and expires in " +
  `${INVITATION_EXPIRY_DAYS} days.`;

export const INVITATION_STATUS_META: Record<InvitationStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: "Pending", tone: "neutral" },
  expired: { label: "Expired", tone: "warning" },
};

/**
 * How each storage category is named and where it is managed.
 *
 * `manageAt` is a path under the workspace, not a full route: the Storage page
 * has the slug and joins the two. Every category points somewhere a person can
 * actually delete something, because a size with no way to act on it is a
 * complaint rather than a setting.
 *
 * `derived` marks a category nobody adds to directly - it grows as a
 * consequence of something else, and shrinks only when that other thing goes.
 * Saying so is the difference between a useful number and a confusing one.
 */
export const STORAGE_CATEGORY_META: Record<
  StorageCategory,
  { label: string; description: string; manageAt: string; derived?: boolean; minimumRole?: MemberRole }
> = {
  knowledgeChunks: {
    label: "Knowledge index",
    description: "Chunks and embedding vectors. Created when a source is processed and removed with it.",
    manageAt: "/knowledge",
    derived: true,
  },
  knowledgeSources: {
    label: "Knowledge sources",
    description: "The text of every document, page and uploaded file in this workspace.",
    manageAt: "/knowledge",
  },
  conversations: {
    label: "Conversations",
    description: "Messages exchanged with chatbots and agents, including the ones your team sent.",
    manageAt: "/conversations",
  },
  crmNotes: {
    label: "CRM notes",
    description: "Notes written against contacts.",
    manageAt: "/crm",
  },
  activityLog: {
    label: "Activity log",
    description: "A line per change made in this workspace. Retained until it is trimmed.",
    manageAt: "/settings/audit",
    derived: true,
    // The audit page is admin-only. Offering the link to a member would send
    // them to a 403, which is worse than showing the size with no link.
    minimumRole: "admin",
  },
};
