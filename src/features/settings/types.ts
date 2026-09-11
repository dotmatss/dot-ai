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
