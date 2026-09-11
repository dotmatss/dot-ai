import { describe, expect, it } from "vitest";

import {
  assignableRoles,
  canAdministerMember,
  canChangeMemberRole,
  canRemoveMember,
  MEMBER_RULE_MESSAGES,
  type MemberActor,
  type MemberSubject,
} from "@/features/settings/member-rules";
import { MEMBER_ROLES, type MemberRole } from "@/features/workspaces/roles";

/**
 * These predicates are the only thing standing between a member list and an
 * organization nobody can administer, so every branch is pinned here. The
 * service evaluates the same functions against rows read under a lock.
 */

const OWNER: MemberActor = { userId: "owner-1", role: "owner" };
const ADMIN: MemberActor = { userId: "admin-1", role: "admin" };
const MEMBER: MemberActor = { userId: "member-1", role: "member" };
const VIEWER: MemberActor = { userId: "viewer-1", role: "viewer" };

function subject(role: MemberRole, userId = `${role}-2`): MemberSubject {
  return { userId, role };
}

function reason(decision: { allowed: boolean; reason?: string }): string | undefined {
  return "reason" in decision ? decision.reason : undefined;
}

describe("canAdministerMember", () => {
  it("refuses anyone who cannot manage members", () => {
    for (const actor of [MEMBER, VIEWER]) {
      const decision = canAdministerMember({ actor, subject: subject("member") });
      expect(decision.allowed).toBe(false);
      expect(reason(decision)).toBe(MEMBER_RULE_MESSAGES.manageRequired);
    }
  });

  it("refuses a non-owner acting on an owner", () => {
    const decision = canAdministerMember({ actor: ADMIN, subject: subject("owner") });
    expect(decision.allowed).toBe(false);
    expect(reason(decision)).toBe(MEMBER_RULE_MESSAGES.ownerRequiredToModifyOwner);
  });

  it("lets an admin act on everyone below an owner", () => {
    for (const role of ["admin", "member", "viewer"] as const) {
      expect(canAdministerMember({ actor: ADMIN, subject: subject(role) }).allowed).toBe(true);
    }
  });

  it("lets an owner act on another owner", () => {
    expect(canAdministerMember({ actor: OWNER, subject: subject("owner") }).allowed).toBe(true);
  });
});

describe("canChangeMemberRole", () => {
  it("refuses a member and a viewer outright", () => {
    for (const actor of [MEMBER, VIEWER]) {
      const decision = canChangeMemberRole({ actor, subject: subject("viewer"), nextRole: "member", ownerCount: 2 });
      expect(decision.allowed).toBe(false);
      expect(reason(decision)).toBe(MEMBER_RULE_MESSAGES.manageRequired);
    }
  });

  it("refuses a non-owner handing out the owner role", () => {
    const decision = canChangeMemberRole({ actor: ADMIN, subject: subject("member"), nextRole: "owner", ownerCount: 1 });
    expect(decision.allowed).toBe(false);
    expect(reason(decision)).toBe(MEMBER_RULE_MESSAGES.ownerRequiredToPromote);
  });

  it("refuses a non-owner touching an owner before it even looks at the target role", () => {
    const decision = canChangeMemberRole({ actor: ADMIN, subject: subject("owner"), nextRole: "admin", ownerCount: 3 });
    expect(decision.allowed).toBe(false);
    expect(reason(decision)).toBe(MEMBER_RULE_MESSAGES.ownerRequiredToModifyOwner);
  });

  it("lets an owner promote anyone", () => {
    expect(
      canChangeMemberRole({ actor: OWNER, subject: subject("member"), nextRole: "owner", ownerCount: 1 }).allowed,
    ).toBe(true);
  });

  it("refuses demoting the last owner", () => {
    const decision = canChangeMemberRole({
      actor: OWNER,
      subject: subject("owner", OWNER.userId),
      nextRole: "admin",
      ownerCount: 1,
    });
    expect(decision.allowed).toBe(false);
    expect(reason(decision)).toBe(MEMBER_RULE_MESSAGES.lastOwnerRole);
  });

  it("allows demoting an owner once a second one exists", () => {
    expect(
      canChangeMemberRole({ actor: OWNER, subject: subject("owner"), nextRole: "admin", ownerCount: 2 }).allowed,
    ).toBe(true);
  });

  it("does not treat re-assigning owner to an owner as a demotion", () => {
    expect(
      canChangeMemberRole({ actor: OWNER, subject: subject("owner"), nextRole: "owner", ownerCount: 1 }).allowed,
    ).toBe(true);
  });

  it("counts owners rather than inspecting the list, so a concurrent demotion cannot slip past", () => {
    // ownerCount is read under FOR UPDATE in the same transaction as the write.
    const decision = canChangeMemberRole({
      actor: OWNER,
      subject: subject("owner"),
      nextRole: "viewer",
      ownerCount: 0,
    });
    expect(decision.allowed).toBe(false);
    expect(reason(decision)).toBe(MEMBER_RULE_MESSAGES.lastOwnerRole);
  });
});

describe("canRemoveMember", () => {
  it("refuses a member and a viewer", () => {
    for (const actor of [MEMBER, VIEWER]) {
      const decision = canRemoveMember({ actor, subject: subject("viewer"), ownerCount: 2 });
      expect(decision.allowed).toBe(false);
      expect(reason(decision)).toBe(MEMBER_RULE_MESSAGES.manageRequired);
    }
  });

  it("refuses an admin removing an owner", () => {
    const decision = canRemoveMember({ actor: ADMIN, subject: subject("owner"), ownerCount: 2 });
    expect(decision.allowed).toBe(false);
    expect(reason(decision)).toBe(MEMBER_RULE_MESSAGES.ownerRequiredToModifyOwner);
  });

  it("lets an admin remove themselves", () => {
    expect(canRemoveMember({ actor: ADMIN, subject: { ...ADMIN }, ownerCount: 1 }).allowed).toBe(true);
  });

  it("lets an owner remove themselves while another owner remains", () => {
    expect(canRemoveMember({ actor: OWNER, subject: { ...OWNER }, ownerCount: 2 }).allowed).toBe(true);
  });

  it("refuses the last owner removing themselves, and says so in the first person", () => {
    const decision = canRemoveMember({ actor: OWNER, subject: { ...OWNER }, ownerCount: 1 });
    expect(decision.allowed).toBe(false);
    expect(reason(decision)).toBe(MEMBER_RULE_MESSAGES.lastOwnerSelf);
  });

  it("refuses removing the last owner on someone else's behalf", () => {
    const decision = canRemoveMember({ actor: OWNER, subject: subject("owner", "owner-9"), ownerCount: 1 });
    expect(decision.allowed).toBe(false);
    expect(reason(decision)).toBe(MEMBER_RULE_MESSAGES.lastOwnerRemove);
  });

  it("lets an admin remove a member, an admin and a viewer", () => {
    for (const role of ["admin", "member", "viewer"] as const) {
      expect(canRemoveMember({ actor: ADMIN, subject: subject(role), ownerCount: 1 }).allowed).toBe(true);
    }
  });
});

describe("assignableRoles", () => {
  it("gives an owner every role", () => {
    expect(assignableRoles("owner")).toEqual([...MEMBER_ROLES]);
  });

  it("withholds owner from an admin", () => {
    expect(assignableRoles("admin")).toEqual(["admin", "member", "viewer"]);
  });

  it("gives a member and a viewer nothing to assign", () => {
    expect(assignableRoles("member")).toEqual([]);
    expect(assignableRoles("viewer")).toEqual([]);
  });

  it("never offers a role the change rule would then refuse", () => {
    for (const actorRole of MEMBER_ROLES) {
      const actor: MemberActor = { userId: "actor", role: actorRole };
      for (const nextRole of assignableRoles(actorRole)) {
        const decision = canChangeMemberRole({ actor, subject: subject("member"), nextRole, ownerCount: 2 });
        expect(decision.allowed).toBe(true);
      }
    }
  });
});
