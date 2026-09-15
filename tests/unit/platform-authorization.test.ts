import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const root = path.resolve(__dirname, "..", "..");
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/api-error";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), audit: vi.fn(), withDb: vi.fn() }));
vi.mock("@/server/auth/dal", () => ({
  requireApiAuth: mocks.auth, getAuthContext: mocks.auth, requireAuthOrRedirect: mocks.auth,
}));
vi.mock("@/server/db/client", () => ({ withDb: mocks.withDb }));
vi.mock("@/server/platform/platform-audit", () => ({ recordPlatformAudit: mocks.audit }));
import { platformRoute } from "@/server/http/platform-route";

describe("platform authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.audit.mockResolvedValue(undefined); });
  it("rejects anonymous requests before invoking the handler", async () => {
    mocks.auth.mockRejectedValue(ApiError.unauthorized());
    const handler = vi.fn();
    expect((await platformRoute(handler)(new NextRequest("http://localhost/api/admin/users"))).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
  it("rejects an authenticated organization owner without a platform grant and audits the denial", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner", email: "owner@example.test" }, session: {} });
    mocks.withDb.mockResolvedValue([]);
    const handler = vi.fn();
    expect((await platformRoute(handler)(new NextRequest("http://localhost/api/admin/users"))).status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "platform.access.denied", actorId: "owner" }));
  });
  it("allows a live platform grant", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin", email: "admin@example.test" }, session: {} });
    mocks.withDb.mockResolvedValue([{ userId: "admin", grantedAt: new Date(), note: null }]);
    const handler = vi.fn().mockResolvedValue(new Response("ok"));
    expect((await platformRoute(handler)(new NextRequest("http://localhost/api/admin/users"))).status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
  it("rejects a cross-origin mutation before invoking the handler", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin", email: "admin@example.test" }, session: {} });
    const handler = vi.fn();
    const request = new NextRequest("http://localhost/api/admin/users/target", {
      method: "PATCH", headers: { origin: "https://other.example", host: "localhost", "x-requested-with": "fetch" },
    });
    expect((await platformRoute(handler)(request)).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
  it("does not label a missing target as a platform access denial", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin", email: "admin@example.test" }, session: {} });
    mocks.withDb.mockResolvedValue([{ userId: "admin", grantedAt: new Date(), note: null }]);
    const handler = vi.fn().mockRejectedValue(ApiError.notFound());
    expect((await platformRoute(handler)(new NextRequest("http://localhost/api/admin/users/missing"))).status).toBe(404);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

/**
 * Structural half of the contract.
 *
 * The tests above prove `platformRoute` behaves correctly. They cannot prove
 * that every admin route USES it - a handler exported bare would pass every
 * behavioural test in this file by simply never being covered by one. That is
 * the failure with no runtime symptom until someone finds the route, so it is
 * asserted by reading the sources, exactly as `agents-authorization.test.ts`
 * does for the workspace guard.
 */
describe("platform route declarations", () => {
  const ADMIN_ROUTES = path.join("src", "app", "api", "admin");
  const HTTP_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

  function routeFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(path.join(root, dir))) {
      const relative = path.join(dir, entry);
      if (statSync(path.join(root, relative)).isDirectory()) out.push(...routeFiles(relative));
      else if (entry === "route.ts") out.push(relative);
    }
    return out;
  }

  it("wraps every exported handler under /api/admin in platformRoute", () => {
    const files = routeFiles(ADMIN_ROUTES);
    // A pattern that matches nothing would pass silently, so prove it found the routes.
    expect(files.length).toBeGreaterThan(0);

    const unguarded: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(root, file), "utf8");
      for (const segment of source.split(/^export const /m).slice(1)) {
        const method = HTTP_METHODS.find((candidate) => segment.startsWith(`${candidate} `));
        // Allows the generic form too: `platformRoute<{ id: string }>(...)`.
        if (method && !/platformRoute\s*(<[^>]*>)?\s*\(/.test(segment)) unguarded.push(`${file}:${method}`);
      }
    }

    expect(unguarded).toEqual([]);
  });

  it("declares no admin handler with a function export, which would bypass the wrapper", () => {
    // `export async function GET()` cannot carry a wrapper at all, so its mere
    // presence under /api/admin is the bug - the check above would not see it.
    const offenders = routeFiles(ADMIN_ROUTES).filter((file) =>
      /^export\s+(async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)\b/m.test(readFileSync(path.join(root, file), "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});
