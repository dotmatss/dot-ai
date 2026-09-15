import "server-only";

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import type { PoolClient } from "pg";

import {
  findInvitationPreviewByTokenHash,
  insertOrganizationMember,
  lockOpenInvitationByTokenHash,
  markInvitationAccepted,
} from "@/features/settings/server/settings-repository";
import type { InvitationPreview } from "@/features/settings/types";
import { findOrganizationDefaultWorkspace } from "@/features/workspaces/server/workspace-repository";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import { withDb, withTransaction } from "@/server/db/client";
import { organizations } from "@/server/db/schema";

/**
 * The invitee's half of the invitation flow.
 *
 * Everything else about membership lives in `settings-service.ts` behind a
 * `SettingsActor`, which this side cannot have: the person accepting is not a
 * member of the organization yet and may not even have an account. So the
 * authorization here is the token plus the email it was issued to, and nothing
 * in this module takes an organization id from a caller.
 *
 * The token itself is never compared in SQL; its SHA-256 is, against the unique
 * `token_hash` column, so a database that leaks still contains no usable link.
 */

export interface InvitationClaimant {
  id: string;
  email: string;
}

const INVALID_MESSAGE = "This invitation link is not valid, or it has already been used.";
const EXPIRED_MESSAGE = "This invitation has expired. Ask for a new one.";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * What the invitee is shown before deciding.
 *
 * Returns null rather than throwing for an unknown token: the page renders the
 * same "not valid" state for a revoked, accepted, mistyped or forged link, so
 * that a caller cannot tell them apart by the response.
 */
export function previewInvitation(token: string): Promise<InvitationPreview | null> {
  return findInvitationPreviewByTokenHash(hashToken(token));
}

/**
 * Turns an open invitation into a membership row, inside the caller's transaction.
 *
 * Exported for the one flow that must do this atomically with something else:
 * signing up *through* an invitation creates the user and joins the
 * organization together, so a failure cannot leave an account with no
 * organization and a consumed invitation.
 *
 * The row is locked for the rest of the transaction, which is what makes a
 * double click on the link safe: the second attempt finds `accepted_at` set and
 * fails the open check.
 */
export async function claimInvitation(
  client: PoolClient,
  token: string,
  user: InvitationClaimant,
): Promise<{ organizationId: string }> {
  const invitation = await lockOpenInvitationByTokenHash(hashToken(token), client);
  if (!invitation) throw ApiError.notFound(INVALID_MESSAGE);
  // `FOR SHARE` holds the organization row for the rest of the transaction, so
  // a suspension landing mid-acceptance cannot be overtaken by this insert.
  const organizationRows = await withDb(
    (db) =>
      db
        .select({ status: organizations.status })
        .from(organizations)
        .where(eq(organizations.id, invitation.organizationId))
        .for("share"),
    client,
  );
  if (organizationRows[0]?.status !== "active") throw ApiError.forbidden("This organization is unavailable");
  if (invitation.expiresAt.getTime() <= Date.now()) throw ApiError.badRequest(EXPIRED_MESSAGE);

  // An invitation is issued to an address, not to whoever holds the link. A
  // forwarded link therefore cannot quietly add a different account, which is
  // the difference between an invitation and a join code.
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    throw ApiError.forbidden(`This invitation was sent to ${invitation.email}. Sign in as that account to accept it.`);
  }

  // A membership that already exists wins: `ON CONFLICT DO NOTHING` keeps an
  // existing role rather than letting a stale invitation quietly re-grade
  // someone who was promoted in the meantime.
  await insertOrganizationMember(invitation.organizationId, user.id, invitation.role, client);
  await markInvitationAccepted(invitation.id, user.id, client);

  return { organizationId: invitation.organizationId };
}

/**
 * Accepts an invitation for an account that already exists, and reports where
 * to send them: membership is organization-wide, so any workspace in it will
 * load, and the oldest is the one every other default lands on.
 */
export async function acceptInvitation(
  token: string,
  user: InvitationClaimant & { name: string },
): Promise<{ workspaceSlug: string }> {
  return withTransaction(async (client) => {
    const { organizationId } = await claimInvitation(client, token, user);

    const workspace = await findOrganizationDefaultWorkspace(organizationId, client);
    if (!workspace) {
      // An organization with no workspace cannot be entered. This should not
      // happen - sign-up creates one - so it is an error, not an empty state.
      throw ApiError.badRequest("That organization has no workspace yet. Ask whoever invited you to create one.");
    }

    // `activity_log` is workspace-scoped and force-RLS, but its policy passes
    // when `app.workspace_id` is unset, which is the case here: this
    // transaction spans two organizations' worth of nothing until the line
    // above resolves one. The insert is still pinned to a workspace id read in
    // this same transaction.
    await recordActivity(
      {
        workspaceId: workspace.id,
        actorId: user.id,
        entityType: "organization_member",
        entityId: user.id,
        action: "joined",
        summary: `${user.name} accepted an invitation and joined the organization`,
      },
      client,
    );

    return { workspaceSlug: workspace.slug };
  });
}
