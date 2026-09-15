import "server-only";

import { z } from "zod";

import { organizationStatusSchema, userStateSchema } from "@/features/platform/schemas";
import {
  deleteUserSessions,
  findOrganizationIdentity,
  findUserIdentity,
  getOrganizationDetail,
  getUserDetail,
  setUserDisabled,
  updateOrganizationStatus,
} from "@/features/platform/server/platform-repository";
import type { PlatformOrganizationDetail, PlatformUserDetail } from "@/features/platform/types";
import { ApiError } from "@/lib/api/api-error";
import { getPlatformGrant } from "@/server/auth/platform-dal";
import { withTransaction } from "@/server/db/client";
import { recordPlatformAudit } from "@/server/platform/platform-audit";

/**
 * Business rules for the platform plane.
 *
 * Authorization is NOT re-implemented here. Every caller has already passed
 * `platformRoute` or `requirePlatformAccess`, and a second, subtly different
 * check in the service is how two implementations of one security decision
 * begin to disagree. The actor arrives as an argument, resolved from the
 * authenticated session by the guard and never from a request body, so an audit
 * row records a fact rather than a claim.
 *
 * What this layer does own: what may be done, what must be recorded, and what
 * stays impossible even for a fully authorized operator.
 *
 * Input is re-validated here rather than trusted from the route. The schemas
 * carry real rules ("a suspension needs a reason"), and a service that is only
 * safe when called by one particular route is one that will eventually be
 * called by something else - a script, a job, a second route.
 */

export interface PlatformActor {
  id: string;
  email: string;
}

const uuidSchema = z.uuid();

/** Rejects a malformed id before PostgreSQL sees it as an invalid cast. */
function assertUuid(value: string, label: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw ApiError.badRequest(`${label} is not a valid id`);
  return parsed.data;
}

/**
 * Moves an organization between lifecycle states.
 *
 * Three properties worth stating, because each is a decision rather than an
 * implementation detail:
 *
 * 1. **Nothing is deleted.** Suspension and disablement are access decisions.
 *    No workspace, chatbot, conversation or knowledge row is touched, which is
 *    what makes both states reversible and what keeps an operator's mistake
 *    from becoming a data-loss incident.
 * 2. **A no-op is refused** with a 409, rather than writing an audit row for a
 *    change that did not happen. It also stops a double-submitted form
 *    reporting success twice for one real transition.
 * 3. **The write and its audit record share one transaction.** A status change
 *    that committed without its record would be exactly the case the record
 *    exists for, so `recordPlatformAudit` receives the transaction client and
 *    is allowed to fail the whole thing.
 */
export async function changeOrganizationStatus(
  actor: PlatformActor,
  organizationId: string,
  input: unknown,
): Promise<PlatformOrganizationDetail> {
  const id = assertUuid(organizationId, "Organization");
  const parsed = organizationStatusSchema.parse(input);

  // Restoring access clears the old justification, rather than leaving a stale
  // "suspended for non-payment" attached to an organization that is active.
  const reason = parsed.status === "active" ? null : (parsed.reason ?? null);

  // Read, decide and write inside ONE transaction, with the row locked by
  // `findOrganizationIdentity`. Reading outside it would let two operators
  // suspending the same tenant simultaneously both observe `active`, both pass
  // the no-op check below, and both write - one real transition, two audit rows
  // disagreeing about what it moved from.
  await withTransaction(async (client) => {
    const existing = await findOrganizationIdentity(id, client);
    if (!existing) throw ApiError.notFound("Organization not found");
    if (existing.status === parsed.status) {
      throw ApiError.conflict(`Organization is already ${parsed.status}`);
    }

    await updateOrganizationStatus(id, parsed.status, reason, client);
    await recordPlatformAudit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: "organization.status.changed",
        targetType: "organization",
        targetId: id,
        targetLabel: existing.name,
        metadata: { before: existing.status, after: parsed.status, reason },
      },
      client,
    );
  });

  const detail = await getOrganizationDetail(id);
  if (!detail) throw ApiError.notFound("Organization not found");
  return detail;
}

/**
 * Disables or re-enables an account.
 *
 * Two refusals that are safety rails rather than policy, enforced here because
 * the UI cannot be what enforces them:
 *
 * - **An operator cannot disable their own account.** The platform grant is
 *   held out of band and cannot be restored through the product, so this would
 *   be a one-way lockout rather than an inconvenience.
 * - **An operator cannot disable another platform admin.** That would let one
 *   operator lock out another through an ordinary product screen. Removing a
 *   peer's access is a deliberate, out-of-band act
 *   (`scripts/grant-platform-admin.mjs --revoke`) and has to stay one.
 *
 * Disabling also ends every live session. Without that, "disabled" would take
 * effect whenever the account's cookie happened to expire, which is not a
 * control. The count is recorded so the audit row says what was interrupted.
 */
export async function changeUserState(
  actor: PlatformActor,
  userId: string,
  input: unknown,
): Promise<PlatformUserDetail> {
  const id = assertUuid(userId, "User");
  const parsed = userStateSchema.parse(input);

  // The two lockout rails are checked before the transaction: neither can race,
  // because neither self-identity nor a platform grant changes as a result of
  // this call, and refusing early keeps a pointless lock off the row.
  if (parsed.disabled && id === actor.id) {
    throw ApiError.badRequest("You cannot disable your own account");
  }

  if (parsed.disabled && (await getPlatformGrant(id))) {
    throw ApiError.forbidden(
      "This account holds a platform grant. Revoke the grant with scripts/grant-platform-admin.mjs before disabling it.",
    );
  }

  const reason = parsed.disabled ? (parsed.reason ?? null) : null;

  // Locked read, decision and write in one transaction, as above.
  await withTransaction(async (client) => {
    const existing = await findUserIdentity(id, client);
    if (!existing) throw ApiError.notFound("User not found");
    if ((existing.disabledAt !== null) === parsed.disabled) {
      throw ApiError.conflict(parsed.disabled ? "Account is already disabled" : "Account is already active");
    }

    await setUserDisabled(id, parsed.disabled, reason, client);
    // Re-enabling restores the ability to sign in, never the old sessions:
    // those were ended deliberately, and a revoked cookie must stay revoked.
    const revokedCount = parsed.disabled ? await deleteUserSessions(id, client) : 0;
    await recordPlatformAudit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: parsed.disabled ? "user.disabled" : "user.enabled",
        targetType: "user",
        targetId: id,
        // The subject's email identifies the target and is not a credential.
        // It is also what keeps the record readable after the row is deleted.
        targetLabel: existing.email,
        metadata: { reason, revokedCount },
      },
      client,
    );
  });

  const detail = await getUserDetail(id);
  if (!detail) throw ApiError.notFound("User not found");
  return detail;
}
