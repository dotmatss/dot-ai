/**
 * Authorization contract for the agent routes.
 *
 * With several agents per workspace, "who may do this" stops being a question
 * about one object and becomes a rule applied to a collection - so the rule is
 * pinned here rather than left implicit in each handler.
 *
 * The UI hides what a role cannot do (`canEdit`, `canManage` in the list and
 * the create dialog), but hiding a button is not a control. Every agent route
 * must therefore go through `workspaceRoute`, which authenticates the session,
 * resolves membership of the workspace in the URL and enforces a minimum role
 * before the handler body runs. A route that forgot its wrapper, or a mutation
 * that quietly dropped to the `viewer` default, would leave no other trace.
 *
 * These assertions read the route sources. That is deliberate: the guard is a
 * property of how the handler is declared, and invoking it would test a mock of
 * the DAL instead.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MEMBER_ROLES, hasMinimumRole, type MemberRole } from "@/features/workspaces/roles";

const root = path.resolve(__dirname, "..", "..");
const AGENT_ROUTES_DIR = path.join("src", "app", "api", "v1", "w", "[workspaceSlug]", "agents");

const HTTP_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

function routeFiles(dir: string): string[] {
  const absolute = path.join(root, dir);
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const full = path.join(absolute, entry);
    const relative = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...routeFiles(relative));
    } else if (entry === "route.ts") {
      out.push(relative);
    }
  }
  return out;
}

interface RouteExport {
  file: string;
  /** Path as the client addresses it, e.g. `agents/[agentId]`. */
  route: string;
  method: HttpMethod;
  source: string;
}

/**
 * Splits a route module into its exported handlers. `export const GET = ...`
 * through to the next `export const`, which is enough to attribute an options
 * object to the handler it belongs to without parsing TypeScript.
 */
function routeExports(file: string): RouteExport[] {
  const source = readFileSync(path.join(root, file), "utf8");
  const route = path
    .relative(path.join("src", "app", "api", "v1", "w", "[workspaceSlug]"), path.dirname(file))
    .split(path.sep)
    .join("/");

  const segments = source.split(/^export const /m).slice(1);
  const out: RouteExport[] = [];
  for (const segment of segments) {
    const method = HTTP_METHODS.find((candidate) => segment.startsWith(`${candidate} `));
    if (method) out.push({ file, route, method, source: segment });
  }
  return out;
}

function minimumRoleOf(handler: RouteExport): MemberRole {
  // No options object means the `workspaceRoute` default, which is `viewer`:
  // authenticated, and a member of this workspace.
  return (handler.source.match(/minimumRole:\s*"(\w+)"/)?.[1] as MemberRole | undefined) ?? "viewer";
}

const HANDLERS = routeFiles(AGENT_ROUTES_DIR).flatMap(routeExports);

/**
 * The intended rule, one entry per `METHOD route`. Reads are membership-only.
 * `satisfies` rather than an annotation so each key keeps its literal role and
 * the lookups below stay exhaustive under `noUncheckedIndexedAccess`.
 */
const EXPECTED = {
  "GET agents": "viewer",
  "POST agents": "member",
  "GET agents/[agentId]": "viewer",
  "PATCH agents/[agentId]": "member",
  "DELETE agents/[agentId]": "admin",
  "GET agents/[agentId]/knowledge": "viewer",
  "GET agents/[agentId]/overview": "viewer",
  // Reading which agents a supervisor may delegate to. A read like any other;
  // the grants themselves are written through PATCH, which requires `member`.
  "GET agents/[agentId]/delegates": "viewer",
  // Running a turn spends tokens and can reach a real MCP tool, so it is an
  // action rather than a read, even though it changes no agent configuration.
  "POST agents/[agentId]/chat": "member",
} satisfies Record<string, MemberRole>;

describe("agent route authorization", () => {
  it("found the agent routes to check", () => {
    // Guards the guard: an empty list would make every assertion below vacuous.
    expect(HANDLERS.length).toBeGreaterThan(4);
  });

  it("puts every agent route behind the workspace guard", () => {
    for (const handler of HANDLERS) {
      expect(handler.source, `${handler.method} ${handler.route} must use workspaceRoute`).toMatch(
        /=\s*workspaceRoute[<(]/,
      );
    }
  });

  it("enforces the intended minimum role on every agent route", () => {
    const actual = Object.fromEntries(HANDLERS.map((handler) => [`${handler.method} ${handler.route}`, minimumRoleOf(handler)]));
    // Compared whole so a NEW agent route cannot appear without a decision
    // being recorded here about who is allowed to call it.
    expect(actual).toEqual(EXPECTED);
  });

  it("lets each role do exactly what its rank allows", () => {
    const decisions = MEMBER_ROLES.map((role) => [
      role,
      {
        read: hasMinimumRole(role, EXPECTED["GET agents"]),
        create: hasMinimumRole(role, EXPECTED["POST agents"]),
        configure: hasMinimumRole(role, EXPECTED["PATCH agents/[agentId]"]),
        run: hasMinimumRole(role, EXPECTED["POST agents/[agentId]/chat"]),
        delete: hasMinimumRole(role, EXPECTED["DELETE agents/[agentId]"]),
      },
    ]);

    expect(Object.fromEntries(decisions)).toEqual({
      // A viewer sees the agents and their analytics, and can change nothing.
      viewer: { read: true, create: false, configure: false, run: false, delete: false },
      // A member builds and tests agents but cannot destroy one.
      member: { read: true, create: true, configure: true, run: true, delete: false },
      admin: { read: true, create: true, configure: true, run: true, delete: true },
      owner: { read: true, create: true, configure: true, run: true, delete: true },
    });
  });

  it("scopes every agent route to a workspace in its own URL", () => {
    // An agent route that was not workspace-scoped would have to resolve the
    // tenant from the agent id, which is the shape tenant leaks come in.
    for (const handler of HANDLERS) {
      expect(handler.file).toContain(path.join("w", "[workspaceSlug]"));
      expect(handler.route.startsWith("agents")).toBe(true);
    }
  });
});
