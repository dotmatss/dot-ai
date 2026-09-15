import { assertUserActive } from "@/server/auth/lifecycle";
import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

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

// A valid-looking hash used to equalize timing when the account does not exist.
const DUMMY_HASH_PROMISE = hashPassword("dummy-password-for-timing");

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
  const hash = user?.passwordHash ?? (await DUMMY_HASH_PROMISE);
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

/** Links an external identity to a user, creating the user on first sign-in. */
export async function findOrCreateUserForIdentity(identity: {
  provider: string;
  providerUid: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}): Promise<AuthenticatedUser> {
  const linkedRows = await withDb((db) =>
    db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(userIdentities)
      .innerJoin(users, eq(users.id, userIdentities.userId))
      .where(and(eq(userIdentities.provider, identity.provider), eq(userIdentities.providerUid, identity.providerUid)))
      .limit(1),
  );
  const linked = linkedRows[0];
  if (linked) { await assertUserActive(linked.id); return linked; }

  return withTransaction(async (client) => {
    let user = (await withDb(
      (db) => db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.email, identity.email)).limit(1),
      client,
    ))[0];
    if (!user) {
      const inserted = await withDb(
        (db) =>
          db
            .insert(users)
            .values({ email: identity.email, name: identity.name, avatarUrl: identity.avatarUrl ?? null })
            .returning({ id: users.id, email: users.email, name: users.name }),
        client,
      );
      user = inserted[0];
    }
    if (!user) throw new Error("Failed to create user");
    await assertUserActive(user.id);
    await withDb(
      (db) =>
        db
          .insert(userIdentities)
          .values({ userId: user.id, provider: identity.provider, providerUid: identity.providerUid })
          .onConflictDoNothing(),
      client,
    );
    return user;
  });
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
