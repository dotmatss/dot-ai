// @vitest-environment node
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/api-error";
import { ok } from "@/server/http/responses";
import { workspaceRoute, type WorkspaceRouteContext } from "@/server/http/workspace-route";

const requireApiWorkspaceAccess = vi.fn();
const requireApiAuth = vi.fn();

vi.mock("@/server/auth/dal", () => ({
  requireApiWorkspaceAccess: (...args: unknown[]) => requireApiWorkspaceAccess(...args),
  requireApiAuth: (...args: unknown[]) => requireApiAuth(...args),
}));

const ACCESS = {
  session: { sessionId: "s1", userId: "u1", expiresAt: new Date() },
  user: { id: "u1", email: "a@b.test", name: "Ada", avatarUrl: null },
  membership: {
    workspace: { id: "ws-1", organizationId: "org-1", name: "Acme", slug: "acme", createdAt: "2026-01-01T00:00:00.000Z" },
    organization: { id: "org-1", name: "Acme", slug: "acme" },
    role: "member" as const,
  },
};

function request(method = "GET", headers: Record<string, string> = {}): NextRequest {
  return new Request("http://localhost:3000/api/v1/w/acme/chatbots", {
    method,
    headers: { host: "localhost:3000", ...headers },
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify({}),
  }) as unknown as NextRequest;
}

const context = { params: Promise.resolve({ workspaceSlug: "acme" }) };

beforeEach(() => {
  requireApiWorkspaceAccess.mockReset();
  requireApiAuth.mockReset();
});

describe("workspaceRoute", () => {
  it("authorizes with the requested minimum role and hands the handler its context", async () => {
    requireApiWorkspaceAccess.mockResolvedValue(ACCESS);
    const handler = vi.fn(async (ctx: WorkspaceRouteContext<{ workspaceSlug: string }>) =>
      ok({ workspace: ctx.membership.workspace.id }),
    );

    const response = await workspaceRoute(handler, { minimumRole: "member" })(request(), context);

    expect(requireApiWorkspaceAccess).toHaveBeenCalledWith("acme", "member");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { workspace: "ws-1" } });
  });

  it("defaults to the viewer role for reads", async () => {
    requireApiWorkspaceAccess.mockResolvedValue(ACCESS);
    await workspaceRoute(async () => ok(null))(request(), context);
    expect(requireApiWorkspaceAccess).toHaveBeenCalledWith("acme", "viewer");
  });

  it("answers an unauthenticated caller with a JSON 401, never a redirect", async () => {
    requireApiWorkspaceAccess.mockRejectedValue(ApiError.unauthorized());

    const response = await workspaceRoute(async () => ok(null))(request(), context);

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
  });

  it("answers an under-privileged caller with 403 and never runs the handler", async () => {
    requireApiWorkspaceAccess.mockRejectedValue(ApiError.forbidden());
    const handler = vi.fn(async () => ok(null));

    const response = await workspaceRoute(handler, { minimumRole: "admin" })(request("DELETE", {
      origin: "http://localhost:3000",
      "x-requested-with": "fetch",
    }), context);

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("hides an inaccessible workspace as 404 rather than confirming it exists", async () => {
    requireApiWorkspaceAccess.mockRejectedValue(ApiError.notFound("Workspace not found"));
    const response = await workspaceRoute(async () => ok(null))(request(), context);
    expect(response.status).toBe(404);
  });

  it("rejects a cross-origin mutation before authorizing it", async () => {
    const handler = vi.fn(async () => ok(null));

    const response = await workspaceRoute(handler, { minimumRole: "member" })(
      request("POST", { origin: "https://evil.example", "x-requested-with": "fetch" }),
      context,
    );

    expect(response.status).toBe(403);
    // The CSRF check runs first, so a forged request never reaches the database.
    expect(requireApiWorkspaceAccess).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("requires the fetch marker on mutations", async () => {
    const response = await workspaceRoute(async () => ok(null), { minimumRole: "member" })(
      request("POST", { origin: "http://localhost:3000" }),
      context,
    );
    expect(response.status).toBe(403);
    expect(requireApiWorkspaceAccess).not.toHaveBeenCalled();
  });

  it("maps an unexpected handler failure to a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    requireApiWorkspaceAccess.mockResolvedValue(ACCESS);

    const response = await workspaceRoute(async () => {
      throw new Error("boom: postgres://user:hunter2@db/app");
    })(request(), context);

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.not.toContain("hunter2");
    spy.mockRestore();
  });
});
