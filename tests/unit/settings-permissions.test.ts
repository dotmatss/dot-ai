// @vitest-environment node
/**
 * Keeps the Roles & permissions page honest.
 *
 * The page renders `CAPABILITIES` as a matrix of who may do what. That is a
 * claim about the server, and a claim nothing checks is documentation that
 * rots: the day someone lowers a route's floor, the page keeps telling every
 * viewer the old story. So every capability names the route file that carries
 * its floor, and this test reads the file.
 *
 * It is deliberately textual rather than type-level. The floor is an argument
 * to `workspaceRoute`, which types cannot pin across files, and the repo
 * already asserts conventions this way (`public-chatbot-isolation.test.ts`
 * walks the import graph; `rls.integration.test.ts` walks the migrations).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CAPABILITIES, CAPABILITY_AREAS, capabilitiesByArea } from "@/features/settings/permissions";
import { SETTINGS_TABS } from "@/features/settings/constants";
import { hasMinimumRole, MEMBER_ROLES, type MemberRole } from "@/features/workspaces/roles";

const root = path.resolve(__dirname, "..", "..");
const API_ROOT = path.join(root, "src", "app", "api", "v1", "w", "[workspaceSlug]");

function routeSource(relativePath: string): string {
  const file = path.join(API_ROOT, relativePath);
  expect(existsSync(file), `${relativePath} should exist`).toBe(true);
  return readFileSync(file, "utf8");
}

/** Every floor declared in one route file, e.g. ["member", "admin"]. */
function declaredFloors(source: string): MemberRole[] {
  return [...source.matchAll(/minimumRole:\s*"(\w+)"/g)].map((match) => match[1] as MemberRole);
}

describe("capability table", () => {
  it("uses unique keys and known areas", () => {
    const keys = CAPABILITIES.map((capability) => capability.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const capability of CAPABILITIES) {
      expect(CAPABILITY_AREAS).toContain(capability.area);
      expect(MEMBER_ROLES).toContain(capability.minimumRole);
      expect(capability.label.length).toBeGreaterThan(0);
    }
  });

  it("lists every capability exactly once when grouped", () => {
    const grouped = capabilitiesByArea().flatMap((group) => group.capabilities);
    expect(grouped).toHaveLength(CAPABILITIES.length);
  });

  // The matrix claims a floor; the route is what enforces one. If these drift,
  // the page is lying to exactly the people who rely on it.
  it("matches the floor each route handler actually enforces", () => {
    for (const capability of CAPABILITIES) {
      if (!capability.enforcedBy) continue;
      const floors = declaredFloors(routeSource(capability.enforcedBy));
      expect(floors.length, `${capability.key}: ${capability.enforcedBy} declares no floor`).toBeGreaterThan(0);
      expect(floors, `${capability.key} claims ${capability.minimumRole}`).toContain(capability.minimumRole);
    }
  });

  // A capability with no route file is one the page layer alone enforces, and
  // that is only defensible when it is a plain read.
  it("only omits a route for viewer-level reads", () => {
    for (const capability of CAPABILITIES) {
      if (capability.enforcedBy === null) expect(capability.minimumRole).toBe("viewer");
    }
  });
});

describe("settings tabs", () => {
  it("gates the audit log and nothing a person needs for their own account", () => {
    const floors = new Map(SETTINGS_TABS.map((tab) => [tab.path, tab.minimumRole ?? "viewer"]));
    expect(floors.get("/audit")).toBe("admin");
    // Profile and Security are self-service: a floor here would lock someone
    // out of their own sessions list.
    expect(floors.get("/profile")).toBe("viewer");
    expect(floors.get("/security")).toBe("viewer");
  });

  it("agrees with the floor each settings page enforces", () => {
    const pagesRoot = path.join(root, "src", "app", "w", "[workspaceSlug]", "settings");
    for (const tab of SETTINGS_TABS) {
      const file = path.join(pagesRoot, tab.path, "page.tsx");
      expect(existsSync(file), `settings${tab.path}/page.tsx should exist`).toBe(true);
      const source = readFileSync(file, "utf8");
      const match = source.match(/requireWorkspaceAccess\(\s*workspaceSlug\s*(?:,\s*"(\w+)")?\s*\)/);
      expect(match, `settings${tab.path} should call requireWorkspaceAccess`).not.toBeNull();
      const pageFloor = (match?.[1] ?? "viewer") as MemberRole;
      expect(pageFloor, `settings${tab.path}: tab floor and page floor disagree`).toBe(tab.minimumRole ?? "viewer");
    }
  });

  // Ranks are total, so privilege must be monotonic: a promotion can add tabs
  // and must never take one away. A hand-edited floor breaks this first.
  it("never hides a tab from a more privileged role", () => {
    const visibleFor = (role: MemberRole) =>
      new Set(SETTINGS_TABS.filter((tab) => hasMinimumRole(role, tab.minimumRole ?? "viewer")).map((tab) => tab.path));

    for (const role of MEMBER_ROLES) {
      for (const lower of MEMBER_ROLES.filter((candidate) => hasMinimumRole(role, candidate))) {
        for (const path of visibleFor(lower)) expect(visibleFor(role)).toContain(path);
      }
    }
  });
});
