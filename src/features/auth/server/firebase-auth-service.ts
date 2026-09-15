import "server-only";

import {
  findDefaultWorkspaceSlug,
  findOrCreateUserForIdentity,
  findUserByEmail,
  findUserByIdentity,
  syncEmailVerified,
  type AuthenticatedUser,
  type ExternalIdentity,
  type RegistrationResult,
} from "@/features/auth/server/auth-service";
import { claimInvitation } from "@/features/settings/server/invitation-service";
import {
  findOrganizationDefaultWorkspace,
  insertOrganization,
  insertWorkspace,
} from "@/features/workspaces/server/workspace-repository";
import { ApiError } from "@/lib/api/api-error";
import { assertUserActive } from "@/server/auth/lifecycle";
import {
  FirebaseNotConfiguredError,
  FirebaseTokenError,
  verifyFirebaseIdToken,
  type FirebaseIdTokenClaims,
} from "@/server/auth/firebase/verify-id-token";
import { withTransaction } from "@/server/db/client";

/**
 * Firebase sign-in, registration and verification, expressed against the
 * application's own user model.
 *
 * The one thing to keep in mind reading this file: an ID token is the ONLY
 * input any of these functions trusts. Every value that decides something -
 * which account this is, which address it owns, whether that address is
 * verified - is read from the verified token's claims. The plain arguments
 * alongside it (`name`, `organizationName`) are profile text the caller typed;
 * they are stored, never authorized on.
 *
 * Nothing here decides what a user may DO. That stays in `server/auth/dal.ts`
 * and `server/auth/platform-dal.ts`, reading `organization_members.role` and
 * `platform_admins` exactly as before.
 */

/** The provider key written to `user_identities.provider`. */
export const FIREBASE_PROVIDER = "firebase";

/**
 * Verifies an ID token and maps its failures onto the application's error
 * vocabulary.
 *
 * Three distinct outcomes, because they call for three different responses:
 * a bad token is the caller's problem (401), an unconfigured deployment is
 * ours and is a programming/deploy error (500), and an unreachable Google is
 * transient (503). Collapsing them into one would have an operator chasing a
 * user's expired token during a Google outage.
 *
 * `reason` is logged, never returned: it names which check failed, and a
 * caller that could read that would have an oracle for probing tokens.
 */
export async function verifyIdTokenOrThrow(idToken: string): Promise<FirebaseIdTokenClaims> {
  try {
    return await verifyFirebaseIdToken(idToken);
  } catch (error) {
    if (error instanceof FirebaseTokenError) {
      console.warn("[auth] rejected Firebase ID token:", error.reason);
      throw ApiError.unauthorized(error.message);
    }
    if (error instanceof FirebaseNotConfiguredError) {
      console.error("[auth] Firebase sign-in was attempted but FIREBASE_PROJECT_ID is not set");
      throw ApiError.internal("Firebase authentication is not configured on this server.");
    }
    console.error("[auth] could not verify Firebase ID token", error);
    throw ApiError.unavailable("Could not verify your sign-in right now. Try again in a moment.");
  }
}

/**
 * The identity a verified token describes.
 *
 * An address is mandatory. This application keys accounts, invitations and
 * every "who is this" surface on an email address, so a token without one
 * (phone sign-in, an anonymous session) has nothing to attach an account to.
 * Refusing here is better than inventing a placeholder address that would then
 * collide with a real one.
 */
function identityFrom(claims: FirebaseIdTokenClaims, fallbackName?: string): ExternalIdentity {
  if (!claims.email) {
    throw ApiError.badRequest("This sign-in method does not provide an email address, which this application requires.");
  }
  // Normalised the same way `emailSchema` normalises typed input, so the citext
  // column, the invitation lookup and the token all agree.
  const email = claims.email.trim().toLowerCase();
  // The token's name first: it is the provider's, it is verified, and for a
  // Google registration it is the only one there is. Then whatever was typed.
  // Then the address itself - `users.name` is NOT NULL, and an account with a
  // blank name renders as an empty avatar and an empty menu rather than
  // failing loudly, so the last resort is something rather than nothing.
  const name = claims.name?.trim() || fallbackName?.trim() || email.split("@")[0] || email;
  return {
    provider: FIREBASE_PROVIDER,
    providerUid: claims.uid,
    email,
    name,
    avatarUrl: claims.picture,
    emailVerified: claims.emailVerified,
  };
}

export interface FirebaseSignInResult {
  user: AuthenticatedUser;
  emailVerified: boolean;
  /** Null when the account belongs to no organization yet. */
  workspaceSlug: string | null;
}

/**
 * Signs in an existing application user with a Firebase ID token.
 *
 * Refuses to create an application account, which is the explicit handling §9
 * asks for when a Firebase user has no PostgreSQL user: registration creates
 * organizations and workspaces, and a sign-in that quietly did the same would
 * turn a typo in an email address into a second, empty tenant.
 *
 * The one thing it will do is complete a link: an account that already exists
 * for this VERIFIED address adopts the Firebase identity on first sign-in.
 * That is the migration path, and `findOrCreateUserForIdentity` is what refuses
 * to do it for an unverified address.
 */
export async function signInWithFirebase(idToken: string): Promise<FirebaseSignInResult> {
  const claims = await verifyIdTokenOrThrow(idToken);

  const linked = await findUserByIdentity(FIREBASE_PROVIDER, claims.uid);
  if (linked) {
    await assertUserActive(linked.id);
    await syncEmailVerified(linked.id, claims.emailVerified);
    return { user: linked, emailVerified: claims.emailVerified, workspaceSlug: await findDefaultWorkspaceSlug(linked.id) };
  }

  const identity = identityFrom(claims);

  // Only ever used to choose between "link an account that already exists" and
  // "refuse" - never to authenticate. `findOrCreateUserForIdentity` re-applies
  // the verified-address rule below, so reaching this branch is not a way past
  // it.
  const existingByEmail = await findUserByEmail(identity.email);
  if (!existingByEmail) {
    // Says what to do rather than what failed. Someone reaching this has a
    // working Firebase account and no application account - almost always
    // because they signed up somewhere else, or were never invited.
    throw ApiError.forbidden(
      "This sign-in is not linked to an account here. Create an account, or ask an administrator for an invitation.",
    );
  }

  const { user } = await findOrCreateUserForIdentity(identity);
  return { user, emailVerified: claims.emailVerified, workspaceSlug: await findDefaultWorkspaceSlug(user.id) };
}

export interface FirebaseRegistrationInput {
  idToken: string;
  /** Absent for a Google registration; the verified token carries the name. */
  name?: string;
  organizationName: string;
}

/**
 * Creates the application half of a Firebase registration.
 *
 * The Firebase account already exists by the time this runs - the browser
 * created it, so the password went to Firebase and never to this server - and
 * this is step 5 onwards of §4: the application user, the organization, the
 * workspace, and the Firebase UID recorded in `user_identities`.
 *
 * ── Idempotent, by construction rather than by luck ─────────────────────────
 *
 * Registration is the operation most likely to be retried: a browser reload, a
 * double submit, a request that timed out after the write landed, or a user
 * whose Firebase account was created on a previous attempt that failed before
 * this point. So every step asks what already exists:
 *
 *   - the user is resolved through `findOrCreateUserForIdentity`, which is
 *     idempotent on the (provider, provider_uid) unique constraint;
 *   - an organization is created ONLY for an account that belongs to none.
 *
 * A second call therefore returns the same workspace instead of a second
 * tenant, which is the failure this would otherwise produce - and the expensive
 * one to unpick, since organizations own workspaces, members and data.
 */
export async function registerWithFirebase(input: FirebaseRegistrationInput): Promise<RegistrationResult & { emailVerified: boolean }> {
  const claims = await verifyIdTokenOrThrow(input.idToken);
  const identity = identityFrom(claims, input.name);

  const { user } = await findOrCreateUserForIdentity(identity);

  const existingSlug = await findDefaultWorkspaceSlug(user.id);
  if (existingSlug) return { user, workspaceSlug: existingSlug, emailVerified: claims.emailVerified };

  const workspaceSlug = await withTransaction(async (client) => {
    const organization = await insertOrganization(client, { name: input.organizationName, ownerId: user.id });
    const workspace = await insertWorkspace({ organizationId: organization.id, name: input.organizationName }, client);
    return workspace.slug;
  });

  return { user, workspaceSlug, emailVerified: claims.emailVerified };
}

export interface InvitedFirebaseRegistrationInput {
  idToken: string;
  /** Absent for a Google registration; the verified token carries the name. */
  name?: string;
  invitationToken: string;
}

/**
 * Registration through an invitation: no organization is created, because the
 * invitation already names one.
 *
 * `claimInvitation` re-checks the invitation against the address being
 * registered, and the address it is given comes from the verified token - so
 * forwarding an invitation link to a different account fails there, on the
 * server, with no way for the client to talk it round.
 */
export async function registerInvitedWithFirebase(
  input: InvitedFirebaseRegistrationInput,
): Promise<RegistrationResult & { emailVerified: boolean }> {
  const claims = await verifyIdTokenOrThrow(input.idToken);
  const identity = identityFrom(claims, input.name);
  const { user } = await findOrCreateUserForIdentity(identity);

  const workspaceSlug = await withTransaction(async (client) => {
    const { organizationId } = await claimInvitation(client, input.invitationToken, user);
    const workspace = await findOrganizationDefaultWorkspace(organizationId, client);
    if (!workspace) throw ApiError.badRequest("That organization has no workspace yet.");
    return workspace.slug;
  });

  return { user, workspaceSlug, emailVerified: claims.emailVerified };
}

/**
 * Re-reads verification from a fresh ID token and mirrors it into PostgreSQL.
 *
 * This is the server half of §8, and the reason the client cannot simply tell
 * us it verified: the browser refreshes its Firebase token, which re-fetches
 * the `email_verified` claim FROM Firebase, and hands us the token. We verify
 * the signature and read the claim ourselves. A client asserting
 * `emailVerified: true` in a request body changes nothing here, because
 * nothing here reads a request body.
 */
export async function syncVerificationFromToken(idToken: string): Promise<{ emailVerified: boolean }> {
  const claims = await verifyIdTokenOrThrow(idToken);
  const linked = await findUserByIdentity(FIREBASE_PROVIDER, claims.uid);
  if (!linked) throw ApiError.unauthorized("This sign-in is not linked to an account here.");
  await assertUserActive(linked.id);
  await syncEmailVerified(linked.id, claims.emailVerified);
  return { emailVerified: claims.emailVerified };
}
