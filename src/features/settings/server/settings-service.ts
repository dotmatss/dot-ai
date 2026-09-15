import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { PoolClient } from "pg";

import { getServerEnv } from "@/config/env";
import { INVITATION_EXPIRY_DAYS, USAGE_WINDOW_DAYS } from "@/features/settings/constants";
import {
  canChangeMemberRole,
  canInviteMember,
  canRemoveMember,
  canRevokeInvitation,
  MEMBER_RULE_MESSAGES,
} from "@/features/settings/member-rules";
import type { InviteMemberInput } from "@/features/settings/schemas";
import {
  deleteOrganizationMember,
  findOpenInvitationIdByEmail,
  findOrganizationMember,
  findOrganizationMemberIdByEmail,
  insertOrganizationInvitation,
  listOrganizationInvitations,
  revokeOrganizationInvitation,
  findUserProfile,
  findUserSessionId,
  listOrganizationMembers,
  listUserSessions,
  lockOrganizationOwnerIds,
  sumStorageByCategory,
  sumUsageByKind,
  updateOrganizationMemberRole,
  updateUserProfile,
} from "@/features/settings/server/settings-repository";
import type {
  InvitationCreated,
  MembersOverview,
  OrganizationInvitation,
  OrganizationMember,
  SessionRevocationResult,
  UserProfile,
  UserSessionSummary,
  WorkspaceGeneralSettings,
  WorkspaceStorageSummary,
  WorkspaceUsageSummary,
} from "@/features/settings/types";
import { canManage, type MemberRole } from "@/features/workspaces/roles";
import { updateWorkspaceName } from "@/features/workspaces/server/workspace-repository";
import type { OrganizationSummary } from "@/features/workspaces/types";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import type { WorkspaceContext } from "@/server/auth/dal";
import { clearSessionCookie, destroyAllUserSessions, destroySession } from "@/server/auth/session";
import { withWorkspace } from "@/server/db/client";

/**
 * Settings business rules.
 *
 * Three of the four surfaces here are *not* protected by Row Level Security -
 * `organization_members`, `users` and `sessions` have no `workspace_id` - so
 * this module is where the missing boundary is re-established:
 *
 *  - organization data is always filtered by the organization id that
 *    `requireWorkspaceAccess` resolved for this caller, never by one that
 *    arrived in a request;
 *  - user and session data is always filtered by the *caller's own* user id.
 *    A session id from the URL is only ever used after `findUserSessionId`
 *    proves the row belongs to that user.
 *
 * Membership decisions come from `member-rules.ts` and are evaluated against
 * rows read inside the writing transaction, so the answer cannot be stale.
 */

export interface SettingsActor {
  workspaceId: string;
  organization: OrganizationSummary;
  userId: string;
  /** Denormalized into the activity feed so it survives account deletion. */
  actorName: string;
  role: MemberRole;
  /** The session that made this request; the only one that can be "current". */
  sessionId: string;
}

/** Builds the actor from a route handler's verified workspace context. */
export function settingsActor(ctx: WorkspaceContext): SettingsActor {
  return {
    workspaceId: ctx.membership.workspace.id,
    organization: ctx.membership.organization,
    userId: ctx.user.id,
    actorName: ctx.user.name,
    role: ctx.membership.role,
    sessionId: ctx.session.sessionId,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Path segments reach PostgreSQL as uuid parameters. Checking the shape first
 * keeps a malformed value from failing the cast, which would surface as a 500
 * instead of the 404 it actually is.
 */
function assertUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) throw ApiError.notFound(message);
}

/* -------------------------------------------------------------------------- */
/* General                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The General tab is a read model of the membership the caller was already
 * authorized with, so it costs no extra query.
 */
export function getWorkspaceGeneralSettings(ctx: WorkspaceContext): WorkspaceGeneralSettings {
  const { workspace, organization } = ctx.membership;
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    createdAt: workspace.createdAt,
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
  };
}

/**
 * Renames the workspace. The slug is deliberately left alone: it is in every
 * bookmark, embed snippet and API URL this workspace has handed out.
 */
export async function renameWorkspace(actor: SettingsActor, input: { name: string }): Promise<WorkspaceGeneralSettings> {
  if (!canManage(actor.role)) throw ApiError.forbidden("Only admins and owners can rename this workspace.");

  const workspace = await updateWorkspaceName(actor.workspaceId, input.name);
  if (!workspace) throw ApiError.notFound("Workspace not found");

  await recordActivity({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    entityType: "workspace",
    entityId: actor.workspaceId,
    action: "renamed",
    summary: `Renamed the workspace to “${workspace.name}”`,
  });

  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    createdAt: workspace.createdAt,
    organization: actor.organization,
  };
}

/* -------------------------------------------------------------------------- */
/* Members                                                                     */
/* -------------------------------------------------------------------------- */

function toOverview(members: OrganizationMember[], invitations: OrganizationInvitation[]): MembersOverview {
  return {
    members,
    ownerCount: members.filter((member) => member.role === "owner").length,
    invitations,
  };
}

/**
 * The member list, plus the pending invitations *if the caller may see them*.
 *
 * Seeing who is in your organization is ordinary; seeing the invitation
 * pipeline is not - it carries addresses of people who have not joined, the
 * role each was offered, and who offered it. The roster stays open to every
 * role and the pipeline does not, so the distinction lives in the read model
 * rather than in a route floor that would take the whole page away.
 */
export async function getMembersOverview(actor: SettingsActor): Promise<MembersOverview> {
  const canSeeInvitations = canManage(actor.role);
  const [members, invitations] = await Promise.all([
    listOrganizationMembers(actor.organization.id, actor.userId),
    canSeeInvitations ? listOrganizationInvitations(actor.organization.id) : Promise.resolve([]),
  ]);
  return toOverview(members, invitations);
}

/**
 * Reads the actor's own membership row inside the writing transaction.
 *
 * `requireWorkspaceAccess` already resolved a role, but that read happened
 * before the lock was taken; an admin demoted in the meantime must not still
 * be able to act as one.
 */
async function readActorMember(actor: SettingsActor, client: PoolClient): Promise<OrganizationMember> {
  const self = await findOrganizationMember(actor.organization.id, actor.userId, actor.userId, client);
  if (!self) throw ApiError.forbidden(MEMBER_RULE_MESSAGES.manageRequired);
  return self;
}

async function readSubjectMember(
  actor: SettingsActor,
  targetUserId: string,
  client: PoolClient,
): Promise<OrganizationMember> {
  const subject = await findOrganizationMember(actor.organization.id, targetUserId, actor.userId, client);
  if (!subject) throw ApiError.notFound("Member not found");
  return subject;
}

/**
 * Changes one member's role.
 *
 * `lockOrganizationOwnerIds` runs first so the owner rows are held for the rest
 * of the transaction: the last-owner rule is a read-then-write, and without the
 * lock two concurrent demotions would each see two owners and both succeed.
 * The whole overview is returned so the client's `ownerCount` cannot drift out
 * of step with the list it gates its controls on.
 */
export async function changeMemberRole(
  actor: SettingsActor,
  targetUserId: string,
  nextRole: MemberRole,
): Promise<MembersOverview> {
  assertUuid(targetUserId, "Member not found");

  await withWorkspace(actor.workspaceId, async (client) => {
    const ownerIds = await lockOrganizationOwnerIds(actor.organization.id, client);
    const self = await readActorMember(actor, client);
    const subject = await readSubjectMember(actor, targetUserId, client);

    const decision = canChangeMemberRole({
      actor: { userId: self.userId, role: self.role },
      subject: { userId: subject.userId, role: subject.role },
      nextRole,
      ownerCount: ownerIds.length,
    });
    if (!decision.allowed) throw ApiError.forbidden(decision.reason);
    if (subject.role === nextRole) return;

    const updated = await updateOrganizationMemberRole(actor.organization.id, targetUserId, nextRole, client);
    if (!updated) throw ApiError.notFound("Member not found");

    await recordActivity(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        entityType: "organization_member",
        entityId: subject.userId,
        action: `role:${nextRole}`,
        summary: `Changed ${subject.name}'s role from ${subject.role} to ${nextRole}`,
        metadata: { from: subject.role, to: nextRole },
      },
      client,
    );
  });

  return getMembersOverview(actor);
}

/** Removes a member from the organization, and so from every workspace in it. */
export async function removeMember(actor: SettingsActor, targetUserId: string): Promise<MembersOverview> {
  assertUuid(targetUserId, "Member not found");

  await withWorkspace(actor.workspaceId, async (client) => {
    const ownerIds = await lockOrganizationOwnerIds(actor.organization.id, client);
    const self = await readActorMember(actor, client);
    const subject = await readSubjectMember(actor, targetUserId, client);

    const decision = canRemoveMember({
      actor: { userId: self.userId, role: self.role },
      subject: { userId: subject.userId, role: subject.role },
      ownerCount: ownerIds.length,
    });
    if (!decision.allowed) throw ApiError.forbidden(decision.reason);

    const removed = await deleteOrganizationMember(actor.organization.id, targetUserId, client);
    if (!removed) throw ApiError.notFound("Member not found");

    await recordActivity(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        entityType: "organization_member",
        entityId: subject.userId,
        action: "removed",
        summary: `Removed ${subject.name} from the organization`,
        metadata: { role: subject.role },
      },
      client,
    );
  });

  return getMembersOverview(actor);
}

/* -------------------------------------------------------------------------- */
/* Invitations                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Invites one address into the organization.
 *
 * The link token is generated here and never stored: only its SHA-256 reaches
 * the database, so the URL returned to the inviter is the single copy that
 * exists. That is also why it is returned exactly once, from this call, and is
 * not readable from the invitation list afterwards.
 *
 * Both "already a member" and "already invited" are checked inside the writing
 * transaction rather than before it, because either can become true between a
 * check and an insert; the partial unique index is the backstop that makes the
 * race safe, and these checks are what turn it into a usable message.
 */
export async function inviteMember(actor: SettingsActor, input: InviteMemberInput): Promise<InvitationCreated> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 86_400_000);

  const invitation = await withWorkspace(actor.workspaceId, async (client) => {
    const self = await readActorMember(actor, client);

    const decision = canInviteMember({ actor: { userId: self.userId, role: self.role }, role: input.role });
    if (!decision.allowed) throw ApiError.forbidden(decision.reason);

    const memberId = await findOrganizationMemberIdByEmail(actor.organization.id, input.email, client);
    if (memberId) throw ApiError.conflict(MEMBER_RULE_MESSAGES.inviteAlreadyMember);

    const openInvitation = await findOpenInvitationIdByEmail(actor.organization.id, input.email, client);
    if (openInvitation) throw ApiError.conflict(MEMBER_RULE_MESSAGES.invitePending);

    const created = await insertOrganizationInvitation(
      {
        organizationId: actor.organization.id,
        email: input.email,
        role: input.role,
        tokenHash,
        invitedBy: actor.userId,
        expiresAt,
      },
      client,
    );

    await recordActivity(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        entityType: "organization_invitation",
        entityId: created.id,
        action: "invited",
        summary: `Invited ${input.email} as ${input.role}`,
        metadata: { role: input.role },
      },
      client,
    );

    return created;
  });

  return {
    overview: await getMembersOverview(actor),
    invitation,
    // APP_URL, not a request header: a link that carries an invitation token
    // must be built from configuration the caller cannot influence.
    inviteUrl: `${getServerEnv().APP_URL.replace(/\/$/, "")}/invite/${token}`,
  };
}

/** Withdraws a pending invitation. The row stays, marked revoked, as a record. */
export async function revokeInvitation(actor: SettingsActor, invitationId: string): Promise<MembersOverview> {
  assertUuid(invitationId, "Invitation not found");

  await withWorkspace(actor.workspaceId, async (client) => {
    const self = await readActorMember(actor, client);

    const decision = canRevokeInvitation({ actor: { userId: self.userId, role: self.role } });
    if (!decision.allowed) throw ApiError.forbidden(decision.reason);

    const revoked = await revokeOrganizationInvitation(actor.organization.id, invitationId, client);
    if (!revoked) throw ApiError.notFound("Invitation not found");

    await recordActivity(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        entityType: "organization_invitation",
        entityId: invitationId,
        action: "revoked",
        summary: "Revoked an invitation",
      },
      client,
    );
  });

  return getMembersOverview(actor);
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export function getUserSessions(actor: SettingsActor): Promise<UserSessionSummary[]> {
  return listUserSessions(actor.userId, actor.sessionId);
}

/**
 * Signs one device out. The id in the URL is never the authorization subject:
 * `findUserSessionId` proves the row belongs to the caller first, so a guessed
 * or borrowed session id resolves to a 404 rather than someone else's logout.
 */
export async function revokeUserSession(actor: SettingsActor, sessionId: string): Promise<SessionRevocationResult> {
  assertUuid(sessionId, "Session not found");

  const owned = await findUserSessionId(actor.userId, sessionId);
  if (!owned) throw ApiError.notFound("Session not found");

  await destroySession(owned);
  const currentSessionRevoked = owned === actor.sessionId;
  // The row is the source of truth, but leaving a dead token in the browser
  // would send one pointless authenticated-looking request per navigation.
  if (currentSessionRevoked) await clearSessionCookie();

  return { sessions: await listUserSessions(actor.userId, actor.sessionId), currentSessionRevoked };
}

/**
 * Signs out every device except this one.
 *
 * Expired rows are not touched: `listUserSessions` already excludes them and
 * they cannot authenticate anything.
 */
export async function revokeOtherUserSessions(actor: SettingsActor): Promise<SessionRevocationResult> {
  const sessions = await listUserSessions(actor.userId, actor.sessionId);
  for (const session of sessions) {
    if (session.isCurrent) continue;
    await destroySession(session.id);
  }
  return { sessions: await listUserSessions(actor.userId, actor.sessionId), currentSessionRevoked: false };
}

/** Signs out everywhere, this device included - the "I lost my laptop" button. */
export async function revokeAllUserSessions(actor: SettingsActor): Promise<SessionRevocationResult> {
  await destroyAllUserSessions(actor.userId);
  await clearSessionCookie();
  return { sessions: [], currentSessionRevoked: true };
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

export async function getUserProfile(actor: SettingsActor): Promise<UserProfile> {
  const profile = await findUserProfile(actor.userId);
  if (!profile) throw ApiError.notFound("Profile not found");
  return profile;
}

/**
 * Updates the caller's own name and avatar. The email is not in the patch by
 * design: it is the login identity, so changing it is an authentication change
 * (verification, session handling) rather than a profile edit.
 */
export async function updateProfile(
  actor: SettingsActor,
  input: { name: string; avatarUrl: string | null },
): Promise<UserProfile> {
  const profile = await updateUserProfile(actor.userId, input);
  if (!profile) throw ApiError.notFound("Profile not found");
  return profile;
}

/* -------------------------------------------------------------------------- */
/* Usage                                                                       */
/* -------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Metered usage for the reporting window. Every number comes from
 * `usage_events`; there is no quota to compare it against yet, so the page
 * reports what was recorded and says so.
 */
export async function getWorkspaceUsage(
  workspaceId: string,
  days: number = USAGE_WINDOW_DAYS,
): Promise<WorkspaceUsageSummary> {
  const totals = await sumUsageByKind(workspaceId, days);
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - days * DAY_MS);
  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    days,
    totals,
    totalEvents: totals.reduce((sum, total) => sum + total.events, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What this workspace is holding, by category.
 *
 * Unlike usage this is a standing total, not a window: it answers "how much is
 * here now", and it moves down when something is deleted. The quota it is
 * compared against is the caller's business - the page resolves the
 * `storageBytes` entitlement through the billing read model and passes the
 * answer to the component, the same way it does with the plan label.
 *
 * Largest first, because the whole point of the page is to find what to delete.
 */
export async function getWorkspaceStorage(workspaceId: string): Promise<WorkspaceStorageSummary> {
  const totals = await sumStorageByCategory(workspaceId);
  totals.sort((a, b) => b.bytes - a.bytes);
  return {
    totals,
    totalBytes: totals.reduce((sum, total) => sum + total.bytes, 0),
    totalRows: totals.reduce((sum, total) => sum + total.rows, 0),
  };
}
