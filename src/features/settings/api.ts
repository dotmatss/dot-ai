import type {
  InviteMemberInput,
  UpdateMemberRoleInput,
  UpdateProfileInput,
  UpdateWorkspaceNameInput,
} from "@/features/settings/schemas";
import type {
  InvitationCreated,
  MembersOverview,
  SessionRevocationResult,
  UserProfile,
  UserSessionSummary,
  WorkspaceGeneralSettings,
} from "@/features/settings/types";
import { apiFetch, buildQueryString } from "@/lib/api/http";

const base = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/settings`;

/**
 * Which sessions a bulk revoke ends. Sent as a query parameter rather than a
 * body so the request stays a plain DELETE.
 */
export type SessionRevocationScope = "others" | "all";

/**
 * Client-side API surface for settings.
 *
 * Nothing here can reach another user's data: the server resolves the
 * organization from the authorized workspace and the user from the session, so
 * the only identifier these calls carry is the subject of the change.
 */
export const settingsApi = {
  general: (workspaceSlug: string) => apiFetch<WorkspaceGeneralSettings>(`${base(workspaceSlug)}/general`),
  renameWorkspace: (workspaceSlug: string, input: UpdateWorkspaceNameInput) =>
    apiFetch<WorkspaceGeneralSettings>(`${base(workspaceSlug)}/general`, { method: "PATCH", json: input }),

  members: (workspaceSlug: string) => apiFetch<MembersOverview>(`${base(workspaceSlug)}/members`),
  updateMemberRole: (workspaceSlug: string, userId: string, input: UpdateMemberRoleInput) =>
    apiFetch<MembersOverview>(`${base(workspaceSlug)}/members/${userId}`, { method: "PATCH", json: input }),
  removeMember: (workspaceSlug: string, userId: string) =>
    apiFetch<MembersOverview>(`${base(workspaceSlug)}/members/${userId}`, { method: "DELETE" }),

  // The invite URL comes back only here. Nothing re-reads it, because the
  // server keeps a hash of the token and not the token.
  inviteMember: (workspaceSlug: string, input: InviteMemberInput) =>
    apiFetch<InvitationCreated>(`${base(workspaceSlug)}/invitations`, { method: "POST", json: input }),
  revokeInvitation: (workspaceSlug: string, invitationId: string) =>
    apiFetch<MembersOverview>(`${base(workspaceSlug)}/invitations/${invitationId}`, { method: "DELETE" }),

  sessions: (workspaceSlug: string) => apiFetch<UserSessionSummary[]>(`${base(workspaceSlug)}/sessions`),
  revokeSession: (workspaceSlug: string, sessionId: string) =>
    apiFetch<SessionRevocationResult>(`${base(workspaceSlug)}/sessions/${sessionId}`, { method: "DELETE" }),
  revokeSessions: (workspaceSlug: string, scope: SessionRevocationScope) =>
    apiFetch<SessionRevocationResult>(`${base(workspaceSlug)}/sessions${buildQueryString({ scope })}`, {
      method: "DELETE",
    }),

  profile: (workspaceSlug: string) => apiFetch<UserProfile>(`${base(workspaceSlug)}/profile`),
  updateProfile: (workspaceSlug: string, input: UpdateProfileInput) =>
    apiFetch<UserProfile>(`${base(workspaceSlug)}/profile`, { method: "PATCH", json: input }),
};
