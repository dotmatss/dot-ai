import { assertUserActive } from "@/server/auth/lifecycle";
import "server-only";

import { and, asc, eq, isNull, ne } from "drizzle-orm";

import type { InvitedSignUpInput, SignUpInput } from "@/features/auth/schemas";
import { claimInvitation } from "@/features/settings/server/invitation-service";
import {
  findOrganizationDefaultWorkspace,
  insertOrganization,
  insertWorkspace,
} from "@/features/workspaces/server/workspace-repository";
import { ApiError } from "@/lib/api/api-error";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { withDb, withTransaction } from "@/server/db/client";
import { organizations, userIdentities, users, organizationMembers, workspaces } from "@/server/db/schema";

/**
 * A valid-looking hash used to equalize timing when the account does not exist.
 *
 * Computed on first use rather than at module scope. `hashPassword` draws a
 * random salt, and workerd refuses that at global scope - "Disallowed operation
 * called within global scope. Asynchronous I/O ... and generating random values
 * are not allowed within global scope" - which threw while this module was
 * being imported and so failed every auth action on Workers, sign-up and
 * sign-in alike, before any of them ran.
 *
 * Still computed once per isolate: the promise is cached on first call, so the
 * timing equalization it exists for is unchanged.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("dummy-password-for-timing");
  return dummyHashPromise;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Password identity provider. Other identity providers (Firebase / Google) are
 * expected to verify their own credential and then call `findOrCreateUserForIdentity`
 * so that every provider ends in the same application session.
 */
export async function authenticateWithPassword(email: string, password: string): Promise<AuthenticatedUser | null> {
  const rows = await withDb((db) => db.select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash }).from(users).where(and(eq(users.email, email), isNull(users.disabledAt))).limit(1));
  const user = rows[0];
  const hash = user?.passwordHash ?? (await getDummyHash());
  const valid = await verifyPassword(password, hash);
  if (!user || !user.passwordHash || !valid) return null;
  return { id: user.id, email: user.email, name: user.name };
}

export interface RegistrationResult {
  user: AuthenticatedUser;
  workspaceSlug: string;
}

export async function registerUser(input: SignUpInput): Promise<RegistrationResult> {
  const existing = (await withDb((db) => db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1)))[0];
  if (existing) {
    throw ApiError.conflict("An account with this email already exists");
  }
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (client) => {
    const user = (await withDb((db) => db.insert(users).values({ email: input.email, name: input.name, passwordHash }).returning({ id: users.id, email: users.email, name: users.name }), client))[0];
    if (!user) throw new Error("Failed to create user");
    const organization = await insertOrganization(client, { name: input.organizationName, ownerId: user.id });
    const workspace = await insertWorkspace({ organizationId: organization.id, name: input.organizationName }, client);
    return { user, workspaceSlug: workspace.slug };
  });
}

/**
 * Registration through an invitation.
 *
 * The account and the membership are created in one transaction: a failure
 * anywhere must not leave a new account stranded with no organization, nor an
 * invitation consumed by a user that was never written. No organization is
 * created - the invitation already names one, and `claimInvitation` re-checks
 * that the address being registered is the address it was issued to.
 */
export async function registerInvitedUser(input: InvitedSignUpInput): Promise<RegistrationResult> {
  const existing = (await withDb((db) => db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1)))[0];
  if (existing) {
    throw ApiError.conflict("An account with this email already exists. Sign in to accept the invitation.");
  }
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (client) => {
    const user = (await withDb((db) => db.insert(users).values({ email: input.email, name: input.name, passwordHash }).returning({ id: users.id, email: users.email, name: users.name }), client))[0];
    if (!user) throw new Error("Failed to create user");

    const { organizationId } = await claimInvitation(client, input.invitationToken, user);
    const workspace = await findOrganizationDefaultWorkspace(organizationId, client);
    if (!workspace) throw ApiError.badRequest("That organization has no workspace yet.");

    return { user, workspaceSlug: workspace.slug };
  });
}

/**
 * The outcome of resolving an external identity to an application user.
 *
 * Callers genuinely need to tell these three apart: the sign-in action refuses
 * to create accounts and must know which happened, and "linked-existing-account"
 * is the migration path in `docs/firebase-auth.md` completing for one user.
 */
export type IdentityLinkOutcome = "already-linked" | "linked-existing-account" | "created-account";

export interface ResolvedIdentity {
  user: AuthenticatedUser;
  outcome: IdentityLinkOutcome;
}

export interface ExternalIdentity {
  provider: string;
  providerUid: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  /**
   * Whether the PROVIDER has verified this address. Not a preference and not a
   * hint - it decides whether this identity may be attached to an account that
   * already exists. See below.
   */
  emailVerified: boolean;
}

/**
 * Links an external identity to a user, creating the user on first sign-in.
 *
 * ── The rule that matters ───────────────────────────────────────────────────
 *
 * An identity whose address the provider has NOT verified may never be attached
 * to an account that already exists. Without that rule this function is an
 * account-takeover primitive, and a cheap one: anybody may create a Firebase
 * account claiming `owner@customer.com` - Firebase issues the account without
 * proof, and only asks for proof before marking it verified - and the first
 * sign-in would hand them the existing application user along with its
 * organizations, its role and its data. The email match is the attack, not the
 * authentication.
 *
 * So matching by address may do exactly one thing, and only when the provider
 * says the address is verified: adopt an account that predates this provider.
 * That is the migration path - a user imported into Firebase from `users` signs
 * in for the first time and picks up the account they already had. Every later
 * sign-in matches on the provider UID and never reads the address at all, which
 * is also why changing an address in Firebase cannot move an application
 * account.
 *
 * Creating a NEW account from an unverified identity stays permitted: there is
 * nothing to take over, the account starts `email_verified = false`, and the
 * verification gate keeps it away from anything that matters until Firebase
 * confirms the address.
 */
export async function findOrCreateUserForIdentity(identity: ExternalIdentity): Promise<ResolvedIdentity> {
  const linked = await findUserByIdentity(identity.provider, identity.providerUid);
  if (linked) {
    await assertUserActive(linked.id);
    await syncEmailVerified(linked.id, identity.emailVerified);
    return { user: linked, outcome: "already-linked" };
  }

  const byEmail = (
    await withDb((db) =>
      db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.email, identity.email)).limit(1),
    )
  )[0];

  if (byEmail && !identity.emailVerified) throw emailAlreadyRegistered();

  return withTransaction(async (client) => {
    let user = byEmail;
    if (!user) {
      const inserted = await withDb(
        (db) =>
          db
            .insert(users)
            .values({
              email: identity.email,
              name: identity.name,
              avatarUrl: identity.avatarUrl ?? null,
              emailVerified: identity.emailVerified,
            })
            .onConflictDoNothing({ target: users.email })
            .returning({ id: users.id, email: users.email, name: users.name }),
        client,
      );
      user = inserted[0];
      // No row means a concurrent request created the same address between the
      // read above and this insert. Re-reading resolves that race to ONE
      // account, rather than failing the second caller with a unique violation
      // it could do nothing about.
      if (!user) {
        user = (
          await withDb(
            (db) => db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.email, identity.email)).limit(1),
            client,
          )
        )[0];
        // An account that appeared concurrently is still an account that
        // already exists, and is subject to the same rule.
        if (user && !identity.emailVerified) throw emailAlreadyRegistered();
      }
    }
    if (!user) throw new Error("Failed to create user");
    const resolved = user;
    await assertUserActive(resolved.id);

    // The unique constraint on (provider, provider_uid) is what actually makes
    // this idempotent: two concurrent first sign-ins produce one link row, and
    // the loser is not an error.
    await withDb(
      (db) =>
        db
          .insert(userIdentities)
          .values({ userId: resolved.id, provider: identity.provider, providerUid: identity.providerUid })
          .onConflictDoNothing(),
      client,
    );
    if (identity.emailVerified) {
      await withDb((db) => db.update(users).set({ emailVerified: true }).where(eq(users.id, resolved.id)), client);
    }
    return { user: resolved, outcome: byEmail ? "linked-existing-account" : "created-account" };
  });
}

/**
 * Deliberately specific, because whoever reads it is overwhelmingly likely to
 * be the legitimate owner part-way through the migration, and "something went
 * wrong" would strand them with no idea what to do next.
 *
 * It discloses only that the address is registered - which the password sign-up
 * path already discloses in almost these words, and which anyone controlling
 * the address can confirm regardless. To somebody who does NOT control it, it
 * discloses nothing useful, because the step it asks for is the one they cannot
 * complete.
 */
function emailAlreadyRegistered(): ApiError {
  return ApiError.forbidden(
    "An account already exists for this email address. Verify your email with the link we sent, then sign in again to link it.",
  );
}

/**
 * The application user holding an email address, or null.
 *
 * `email` is `citext`, so this matches case-insensitively in the database
 * rather than relying on every caller to normalise first.
 */
export async function findUserByEmail(email: string): Promise<AuthenticatedUser | null> {
  const rows = await withDb((db) =>
    db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.email, email)).limit(1),
  );
  return rows[0] ?? null;
}

/** The application user an external identity is linked to, or null. */
export async function findUserByIdentity(provider: string, providerUid: string): Promise<AuthenticatedUser | null> {
  const rows = await withDb((db) =>
    db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(userIdentities)
      .innerJoin(users, eq(users.id, userIdentities.userId))
      .where(and(eq(userIdentities.provider, provider), eq(userIdentities.providerUid, providerUid)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Brings `users.email_verified` into line with the identity provider.
 *
 * Mirrors in BOTH directions, because the provider is the source of truth and a
 * one-way mirror would be a lie in one of them: changing an address in Firebase
 * resets its verification, and an application that only ever wrote `true` would
 * go on treating the old, now-unverified address as confirmed.
 *
 * The `ne` in the predicate means an unchanged sign-in writes no row at all.
 * Called from the token paths and nowhere else: no route, action or service
 * lets a client set this column.
 */
export async function syncEmailVerified(userId: string, emailVerified: boolean): Promise<void> {
  await withDb((db) =>
    db
      .update(users)
      .set({ emailVerified, updatedAt: new Date() })
      .where(and(eq(users.id, userId), ne(users.emailVerified, emailVerified))),
  );
}

export async function findDefaultWorkspaceSlug(userId: string): Promise<string | null> {
  const rows = await withDb((db) =>
    db
      .select({ slug: workspaces.slug })
      .from(organizationMembers)
      .innerJoin(workspaces, eq(workspaces.organizationId, organizationMembers.organizationId))
      .innerJoin(organizations, and(eq(organizations.id, organizationMembers.organizationId), eq(organizations.status, "active")))
      .where(eq(organizationMembers.userId, userId))
      .orderBy(asc(workspaces.createdAt))
      .limit(1),
  );
  return rows[0]?.slug ?? null;
}
