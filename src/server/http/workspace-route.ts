import "server-only";

import type { NextRequest } from "next/server";

import type { MemberRole } from "@/features/workspaces/roles";
import { requireApiAuth, requireApiWorkspaceAccess, type AuthContext, type WorkspaceContext } from "@/server/auth/dal";
import { assertSameOrigin } from "@/server/http/request";
import { toErrorResponse } from "@/server/http/responses";

export interface WorkspaceRouteContext<P extends { workspaceSlug: string }> extends WorkspaceContext {
  request: NextRequest;
  params: P;
}

type Handler<P extends { workspaceSlug: string }> = (ctx: WorkspaceRouteContext<P>) => Promise<Response>;

/**
 * Wraps a route handler under /api/v1/w/[workspaceSlug]/...:
 *  1. CSRF/origin check for mutating methods
 *  2. Session authentication
 *  3. Workspace membership + minimum role authorization
 *  4. Uniform error mapping
 */
export function workspaceRoute<P extends { workspaceSlug: string }>(
  handler: Handler<P>,
  options: { minimumRole?: MemberRole } = {},
) {
  return async (request: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      assertSameOrigin(request);
      const params = await context.params;
      const access = await requireApiWorkspaceAccess(params.workspaceSlug, options.minimumRole ?? "viewer");
      return await handler({ ...access, request, params });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/** For authenticated routes that are not workspace-scoped (e.g. /api/v1/me). */
export function authedRoute(handler: (ctx: AuthContext & { request: NextRequest }) => Promise<Response>) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      assertSameOrigin(request);
      const auth = await requireApiAuth();
      return await handler({ ...auth, request });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
