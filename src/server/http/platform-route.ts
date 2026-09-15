import "server-only";

import type { NextRequest } from "next/server";

import { ApiError } from "@/lib/api/api-error";
import { getAuthContext } from "@/server/auth/dal";
import { requireApiPlatformAccess, type PlatformContext } from "@/server/auth/platform-dal";
import { assertSameOrigin } from "@/server/http/request";
import { clientIpFrom } from "@/server/http/rate-limit";
import { toErrorResponse } from "@/server/http/responses";
import { recordPlatformAudit } from "@/server/platform/platform-audit";

export interface PlatformRouteContext<P = Record<string, never>> extends PlatformContext {
  request: NextRequest;
  params: P;
}

type Handler<P> = (ctx: PlatformRouteContext<P>) => Promise<Response>;

/**
 * Wraps a route handler under /api/admin/...:
 *
 *   1. CSRF/origin check for mutating methods (identical to `workspaceRoute`)
 *   2. Session authentication
 *   3. Platform-admin authorization, from `platform_admins` and nothing else
 *   4. An audit record for any authenticated caller the GUARD refused
 *   5. Uniform error mapping
 *
 * This is the ONLY way a platform route may be declared.
 * `tests/unit/platform-authorization.test.ts` reads the route sources and fails
 * if a handler under /api/admin is exported without it, because a route that
 * forgot its wrapper is indistinguishable from one that never needed it until
 * somebody finds it.
 *
 * Note what is deliberately absent: there is no `minimumRole` option and no way
 * to relax the guard per route. A platform route is reachable by a platform
 * admin or by nobody, so there is no weaker setting to be given by mistake.
 *
 * ── Why the guard and the handler have separate catches ─────────────────────
 *
 * Only failures from the GUARD are access denials. A 404 thrown by the handler
 * means an organization id did not resolve - an ordinary outcome of an
 * authorized request. Auditing both would fill the security trail with routine
 * misses and make a genuine probe impossible to spot, so the two phases are
 * kept apart rather than sharing one try block.
 */
export function platformRoute<P = Record<string, never>>(handler: Handler<P>) {
  return async (request: NextRequest, context?: { params: Promise<P> }): Promise<Response> => {
    let access: PlatformContext;
    try {
      assertSameOrigin(request);
      access = await requireApiPlatformAccess();
    } catch (error) {
      await auditDenial(request, error);
      return toErrorResponse(error);
    }

    try {
      const params = ((await context?.params) ?? {}) as P;
      return await handler({ ...access, request, params });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/**
 * Records a refused attempt, but only for a caller who proved a session.
 *
 * Two reasons for that condition. An anonymous 401 carries no actor worth
 * storing, and an unauthenticated caller could otherwise write a row per
 * request, turning the audit table into an amplification target. A signed-in
 * account probing /api/admin is the signal actually worth keeping.
 *
 * This runs outside any transaction, so `recordPlatformAudit` is best effort
 * here by design: a failing audit insert must not turn a correct 404 into a
 * 500, which would tell an unauthorized caller that they found something.
 */
async function auditDenial(request: NextRequest, error: unknown): Promise<void> {
  if (!(error instanceof ApiError)) return;
  if (error.status !== 404 && error.status !== 403) return;

  const auth = await getAuthContext().catch(() => null);
  if (!auth) return;

  await recordPlatformAudit({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action: "platform.access.denied",
    targetType: "platform",
    targetLabel: new URL(request.url).pathname,
    result: "denied",
    metadata: { method: request.method },
    ipAddress: clientIpFrom(request.headers),
  });
}
