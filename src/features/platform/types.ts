/**
 * Client-safe contracts for the platform control plane.
 *
 * Everything here crosses tenant boundaries by design, so what is ABSENT
 * matters as much as what is present. No type below carries:
 *
 *   - a credential, hash, token or secret of any kind
 *   - a customer's conversation, message, knowledge or CRM content
 *   - a provider API key, OAuth token, session token or password hash
 *
 * The operator manages the platform's own configuration and the tenants'
 * lifecycle; they do not get a window into what customers wrote. Anything that
 * would widen that is a product decision, not a field addition.
 *
 * Dates are ISO strings, like every other feature's contracts.
 */

export const ORGANIZATION_STATUSES = ["active", "suspended", "disabled"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/**
 * Platform-wide counters for the Overview.
 *
 * `estimated` is not decoration. Token and message figures are summed from
 * `usage_events`, which the application writes on its own request path: they
 * are a faithful record of what this system metered, not a reconciliation
 * against a provider's billing. The UI says so rather than implying a ledger.
 */
export interface PlatformOverview {
  organizations: { total: number; active: number; suspended: number; disabled: number };
  users: { total: number; disabled: number; newLast30Days: number };
  workspaces: { total: number };
  build: { chatbots: number; agents: number; workflows: number; collections: number };
  activity: {
    conversationsLast30Days: number;
    messagesLast30Days: number;
    workflowRunsLast30Days: number;
    tokensInLast30Days: number;
    tokensOutLast30Days: number;
  };
  /** Live signals only — see `PlatformHealth`. Never a fabricated status. */
  health: PlatformHealth;
}

export type HealthStatus = "healthy" | "degraded" | "unavailable" | "unknown";

/**
 * Operational signals the server can actually observe right now.
 *
 * `unknown` exists so a component that is not instrumented is reported as not
 * instrumented, rather than being drawn green. A dashboard that invents a
 * healthy tick for something it never checked is worse than no dashboard.
 */
export interface PlatformHealth {
  database: { status: HealthStatus; detail: string };
  aiGateway: { status: HealthStatus; detail: string };
  embeddings: { status: HealthStatus; detail: string };
}

export interface PlatformOrganizationSummary {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  createdAt: string;
  workspaceCount: number;
  memberCount: number;
}

/**
 * One organization, as the operator sees it.
 *
 * Counts and lifecycle, not contents: `workspaces` names the workspaces and
 * how much is built in each, `members` names who belongs and with what role.
 * Neither carries anything the customer authored.
 */
export interface PlatformOrganizationDetail extends PlatformOrganizationSummary {
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    chatbots: number;
    agents: number;
    workflows: number;
    collections: number;
  }>;
  members: Array<{
    userId: string;
    name: string;
    email: string;
    role: string;
    disabledAt: string | null;
    joinedAt: string;
  }>;
  usageLast30Days: {
    messages: number;
    tokensIn: number;
    tokensOut: number;
    workflowRuns: number;
  };
}

export interface PlatformUserSummary {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  disabledAt: string | null;
  disabledReason: string | null;
  /** Live grant on the platform plane. Shown so an operator can see their peers. */
  isPlatformAdmin: boolean;
  organizationCount: number;
  lastSeenAt: string | null;
}

export interface PlatformUserDetail extends PlatformUserSummary {
  memberships: Array<{
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    organizationStatus: OrganizationStatus;
    role: string;
    joinedAt: string;
  }>;
  /**
   * Count only. The operator can see that an account has live sessions — which
   * is what makes "disable" meaningful — without seeing a token, a device or
   * an address.
   */
  activeSessions: number;
}

export interface PlatformAuditEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  result: "success" | "denied" | "error";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PlatformOrganizationFilters {
  q?: string;
  status?: OrganizationStatus;
  page?: number;
  pageSize?: number;
}

export interface PlatformUserFilters {
  q?: string;
  state?: "active" | "disabled";
  page?: number;
  pageSize?: number;
}

export interface PlatformAuditFilters {
  q?: string;
  action?: string;
  result?: "success" | "denied" | "error";
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}
