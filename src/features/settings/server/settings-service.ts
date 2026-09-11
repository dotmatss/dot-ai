import "server-only";

import { USAGE_WINDOW_DAYS } from "@/features/settings/constants";
import { canChangeMemberRole, canRemoveMember, MEMBER_RULE_MESSAGES } from "@/features/settings/member-rules";
import {
  deleteOrganizationMember,
  findOrganizationMember,
  findUserProfile,
  findUserSessionId,
  listOrganizationMembers,
  listUserSessions,
  lockOrganizationOwnerIds,
  sumUsageByKind,
  updateOrganizationMemberRole,
  updateUserProfile,
} from "@/features/settings/server/settings-repository";
import type {
  MembersOverview,
  OrganizationMember,
  SessionRevocationResult,
  UserProfile,
  UserSessionSummary,
  WorkspaceGeneralSettings,
  WorkspaceUsageSummary,
} from "@/features/settings/types";
import { canManage, type MemberRole } from "@/features/workspaces/roles";
import { updateWorkspaceName } from "@/features/workspaces/server/workspace-repository";
import type { OrganizationSummary } from "@/features/workspaces/types";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import type { WorkspaceContext } from "@/server/auth/dal";
import { clearSessionCookie, destroyAllUserSessions, destroySession } from "@/server/auth/session";
import { withWorkspace, type Queryable } from "@/server/db/client";

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

function toOverview(members: OrganizationMember[]): MembersOverview {
  return { members, ownerCount: members.filter((member) => member.role === "owner").length };
}

export async function getMembersOverview(actor: SettingsActor): Promise<MembersOverview> {
  return toOverview(await listOrganizationMembers(actor.organization.id, actor.userId));
}

/**
 * Reads the actor's own membership row inside the writing transaction.
 *
 * `requireWorkspaceAccess` already resolved a role, but that read happened
 * before the lock was taken; an admin demoted in the meantime must not still
 * be able to act as one.
 */
async function readActorMember(actor: SettingsActor, client: Queryable): Promise<OrganizationMember> {
  const self = await findOrganizationMember(actor.organization.id, actor.userId, actor.userId, client);
  if (!self) throw ApiError.forbidden(MEMBER_RULE_MESSAGES.manageRequired);
  return self;
}

async function readSubjectMember(
  actor: SettingsActor,
  targetUserId: string,
  client: Queryable,
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
