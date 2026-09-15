import { describe, expect, it } from "vitest";

import { visibleForRole, visibleNavigation, workspaceNavigation } from "@/config/navigation";
import { hasMinimumRole, MEMBER_ROLES, type MemberRole } from "@/features/workspaces/roles";

/**
 * The nav filter is cosmetic, but it is the cosmetic layer two surfaces share -
 * the sidebar and the command palette - so a bug here shows a person a link
 * their role will be refused at, or hides one they are entitled to.
 */

const keysFor = (role: MemberRole) => visibleNavigation(role).flatMap((group) => group.items.map((item) => item.key));

describe("visibleForRole", () => {
  it("treats a missing floor as viewer, which is what every current item relies on", () => {
    const items = [{ key: "open" }, { key: "admin-only", minimumRole: "admin" as const }];
    expect(visibleForRole(items, "viewer").map((item) => item.key)).toEqual(["open"]);
    expect(visibleForRole(items, "admin").map((item) => item.key)).toEqual(["open", "admin-only"]);
  });

  it("keeps an owner's view complete", () => {
    const items = MEMBER_ROLES.map((role) => ({ key: role, minimumRole: role }));
    expect(visibleForRole(items, "owner")).toHaveLength(MEMBER_ROLES.length);
  });
});

describe("visibleNavigation", () => {
  it("shows an owner every item the config declares", () => {
    const declared = workspaceNavigation.flatMap((group) => group.items.map((item) => item.key));
    expect(keysFor("owner")).toEqual(declared);
  });

  it("agrees with hasMinimumRole for every item it returns", () => {
    for (const role of MEMBER_ROLES) {
      for (const group of visibleNavigation(role)) {
        for (const item of group.items) {
          expect(hasMinimumRole(role, item.minimumRole ?? "viewer")).toBe(true);
        }
      }
    }
  });

  // Privilege is monotonic: promoting someone may add links, never remove them.
  it("gives a more privileged role a superset of a less privileged one", () => {
    for (const role of MEMBER_ROLES) {
      for (const lower of MEMBER_ROLES.filter((candidate) => hasMinimumRole(role, candidate))) {
        for (const key of keysFor(lower)) expect(keysFor(role)).toContain(key);
      }
    }
  });

  // A group renders its label from `group.label` alone, so an empty group would
  // leave a heading with nothing under it.
  it("drops groups whose items are all hidden", () => {
    for (const role of MEMBER_ROLES) {
      for (const group of visibleNavigation(role)) expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it("keeps every viewer-visible item reachable, since viewers keep read access", () => {
    // The product decision: a viewer sees the same sections and loses controls,
    // not pages. If a floor is ever added, this test is the one to revisit.
    expect(keysFor("viewer")).toEqual(keysFor("owner"));
  });
});
