import { canManage, MEMBER_ROLES, type MemberRole } from "@/features/workspaces/roles";

/**
 * Authorization rules for editing organization membership.
 *
 * These are pure so the same decision is reachable from three places that must
 * never disagree: the service (the only one that matters), the route handler's
 * error message, and the UI that disables a control before the user clicks it.
 * The server always re-evaluates them against freshly read rows - a decision
 * made from a client-supplied role is not a decision.
 */

export interface MemberActor {
  userId: string;
  role: MemberRole;
}

export interface MemberSubject {
  userId: string;
  role: MemberRole;
}

export type MemberActionDecision = { allowed: true } | { allowed: false; reason: string };

export const MEMBER_RULE_MESSAGES = {
  manageRequired: "Only admins and owners can manage members.",
  ownerRequiredToModifyOwner: "Only an owner can change another owner.",
  ownerRequiredToPromote: "Only an owner can make someone an owner.",
  lastOwnerRole: "This organization must keep at least one owner. Promote someone else first.",
  lastOwnerRemove: "This organization must keep at least one owner. Promote someone else before removing this one.",
  lastOwnerSelf: "You are the last owner of this organization. Promote someone else before removing yourself.",
} as const;

const ALLOWED: MemberActionDecision = { allowed: true };

function deny(reason: string): MemberActionDecision {
  return { allowed: false, reason };
}

/**
 * The two rules that gate *any* change to a member, independent of what the
 * change is: the actor must be able to manage members at all, and only an owner
 * may touch another owner. Exported so the UI can decide whether a row has
 * controls before it knows which control was used.
 */
export function canAdministerMember(input: { actor: MemberActor; subject: MemberSubject }): MemberActionDecision {
  const { actor, subject } = input;
  if (!canManage(actor.role)) return deny(MEMBER_RULE_MESSAGES.manageRequired);
  if (actor.role !== "owner" && subject.role === "owner") {
    return deny(MEMBER_RULE_MESSAGES.ownerRequiredToModifyOwner);
  }
  return ALLOWED;
}

/**
 * May `actor` set `subject`'s role to `nextRole`?
 *
 * `ownerCount` is the number of owners the organization has *right now*,
 * including the subject. The last-owner rule is checked against it rather than
 * against a role list so a concurrent demotion cannot slip past: the service
 * reads and locks the owner rows in the same transaction as the write.
 */
export function canChangeMemberRole(input: {
  actor: MemberActor;
  subject: MemberSubject;
  nextRole: MemberRole;
  ownerCount: number;
}): MemberActionDecision {
  const { actor, subject, nextRole, ownerCount } = input;

  const administer = canAdministerMember({ actor, subject });
  if (!administer.allowed) return administer;

  if (actor.role !== "owner" && nextRole === "owner") {
    return deny(MEMBER_RULE_MESSAGES.ownerRequiredToPromote);
  }
  if (subject.role === "owner" && nextRole !== "owner" && ownerCount <= 1) {
    return deny(MEMBER_RULE_MESSAGES.lastOwnerRole);
  }
  return ALLOWED;
}

/** May `actor` remove `subject` from the organization? */
export function canRemoveMember(input: {
  actor: MemberActor;
  subject: MemberSubject;
  ownerCount: number;
}): MemberActionDecision {
  const { actor, subject, ownerCount } = input;

  const administer = canAdministerMember({ actor, subject });
  if (!administer.allowed) return administer;

  if (subject.role === "owner" && ownerCount <= 1) {
    // Removing yourself is allowed - unless you are the one owner left, which
    // would leave the organization with nobody who can restore it.
    return deny(
      actor.userId === subject.userId ? MEMBER_RULE_MESSAGES.lastOwnerSelf : MEMBER_RULE_MESSAGES.lastOwnerRemove,
    );
  }
  return ALLOWED;
}

/**
 * Roles `actor` is allowed to hand out. An admin can run the member list but
 * cannot mint a peer above themselves, so `owner` is theirs to receive, not to
 * give.
 */
export function assignableRoles(actorRole: MemberRole): MemberRole[] {
  if (!canManage(actorRole)) return [];
  return MEMBER_ROLES.filter((role) => role !== "owner" || actorRole === "owner");
}
