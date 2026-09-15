/**
 * Client-safe settings contracts. Timestamps are ISO strings and every value
 * is JSON-serializable so the same types cross the server/client boundary.
 *
 * Membership lives on the **organization**, not the workspace: the schema has
 * `organization_members` and no `workspace_members` table. Everything member
 * shaped here is therefore organization scoped, resolved from the workspace the
 * caller was authorized for.
 */

import type { MemberRole } from "@/features/workspaces/roles";

/** The workspace record shown on the General tab. */
export interface WorkspaceGeneralSettings {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  organization: { id: string; name: string; slug: string };
}

export interface OrganizationMember {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: MemberRole;
  /** `organization_members.created_at` - when the user joined the organization. */
  joinedAt: string;
  /** Resolved on the server from the session, never from the request body. */
  isCurrentUser: boolean;
}

/**
 * The member list plus the one aggregate every authorization rule needs.
 * `ownerCount` travels with the list so the client can disable the controls the
 * server would reject, instead of discovering it through a failed request.
 */
export interface MembersOverview {
  members: OrganizationMember[];
  ownerCount: number;
  /** Everything still awaiting a decision: pending and expired, never accepted. */
  invitations: OrganizationInvitation[];
}

/**
 * An invitation as the client may see it. There is deliberately no token and no
 * token hash here: the link is shown exactly once, in the response to the call
 * that created it, and is never readable again from a list.
 */
export interface OrganizationInvitation {
  id: string;
  email: string;
  role: MemberRole;
  /** Derived on the server from `expires_at`, so both sides agree on "expired". */
  status: InvitationStatus;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
}

export const INVITATION_STATUSES = ["pending", "expired"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** What the invitee is shown before they accept: no ids, no token, no member list. */
export interface InvitationPreview {
  organizationName: string;
  email: string;
  role: MemberRole;
  /** Decided on the server, so the page never compares a date during render. */
  status: InvitationStatus;
  invitedByName: string | null;
  expiresAt: string;
}

/** The one-time link, returned only to the inviter that created it. */
export interface InvitationCreated {
  overview: MembersOverview;
  invitation: OrganizationInvitation;
  /** Absolute URL built from APP_URL; the only time the raw token is disclosed. */
  inviteUrl: string;
}

/**
 * One row of the caller's own `sessions`. Deliberately carries no token and no
 * token hash: a session is identified to the client by its row id only.
 */
export interface UserSessionSummary {
  id: string;
  /** Human label derived from the user agent, e.g. "Chrome on macOS". */
  deviceLabel: string;
  browser: string | null;
  operatingSystem: string | null;
  /** Truncated user agent, kept for the "what exactly is this?" case. */
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** True for the session that made this request. */
  isCurrent: boolean;
}

/**
 * Result of revoking one or every session. When the caller signed themselves
 * out, `currentSessionRevoked` tells the client to leave for /sign-in rather
 * than render a page it can no longer load.
 */
export interface SessionRevocationResult {
  sessions: UserSessionSummary[];
  currentSessionRevoked: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  /** Read-only: the email is the login identity. */
  email: string;
  avatarUrl: string | null;
}

/**
 * One `usage_events.kind` summed over the reporting window. `kind` is free text
 * in the schema, so a value outside `USAGE_KINDS` is still reported rather than
 * silently dropped - the UI labels what it recognises and falls back to the raw
 * kind for the rest.
 */
export interface UsageKindTotal {
  kind: string;
  /** Sum of `quantity`. */
  total: number;
  /** Number of rows behind that sum. */
  events: number;
}

export interface WorkspaceUsageSummary {
  /** Inclusive start of the reporting window, ISO. */
  periodStart: string;
  periodEnd: string;
  days: number;
  totals: UsageKindTotal[];
  totalEvents: number;
}

/**
 * The storage categories the Storage tab reports, in the order it renders them.
 *
 * Each names a table this workspace owns rows in. They are deliberately a
 * closed set rather than every table with a `workspace_id`: a category earns a
 * row here only when a person can do something about it, which means adding or
 * deleting the records behind it.
 */
export const STORAGE_CATEGORIES = [
  "knowledgeChunks",
  "knowledgeSources",
  "conversations",
  "crmNotes",
  "activityLog",
] as const;
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

export interface StorageCategoryTotal {
  category: StorageCategory;
  /** Logical size of the rows, in bytes. */
  bytes: number;
  /** Number of rows behind that size. */
  rows: number;
}

export interface WorkspaceStorageSummary {
  totals: StorageCategoryTotal[];
  totalBytes: number;
  totalRows: number;
}
