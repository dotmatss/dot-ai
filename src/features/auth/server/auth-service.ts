import "server-only";

import type { SignUpInput } from "@/features/auth/schemas";
import { insertOrganization, insertWorkspace } from "@/features/workspaces/server/workspace-repository";
import { ApiError } from "@/lib/api/api-error";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { query, queryOne, withTransaction } from "@/server/db/client";

interface UserAuthRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
}

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
  const user = await queryOne<UserAuthRow>("SELECT id, email, name, password_hash FROM users WHERE email = $1", [email]);
  const hash = user?.password_hash ?? (await DUMMY_HASH_PROMISE);
  const valid = await verifyPassword(password, hash);
  if (!user || !user.password_hash || !valid) return null;
  return { id: user.id, email: user.email, name: user.name };
}

export interface RegistrationResult {
  user: AuthenticatedUser;
  workspaceSlug: string;
}

export async function registerUser(input: SignUpInput): Promise<RegistrationResult> {
  const existing = await queryOne<{ id: string }>("SELECT id FROM users WHERE email = $1", [input.email]);
  if (existing) {
    throw ApiError.conflict("An account with this email already exists");
  }
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (client) => {
    const user = await queryOne<{ id: string; email: string; name: string }>(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name",
      [input.email, input.name, passwordHash],
      client,
    );
    if (!user) throw new Error("Failed to create user");
    const organization = await insertOrganization(client, { name: input.organizationName, ownerId: user.id });
    const workspace = await insertWorkspace({ organizationId: organization.id, name: input.organizationName }, client);
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
  const linked = await queryOne<{ id: string; email: string; name: string }>(
    `SELECT u.id, u.email, u.name FROM user_identities i JOIN users u ON u.id = i.user_id
     WHERE i.provider = $1 AND i.provider_uid = $2`,
    [identity.provider, identity.providerUid],
  );
  if (linked) return linked;

  return withTransaction(async (client) => {
    let user = await queryOne<{ id: string; email: string; name: string }>(
      "SELECT id, email, name FROM users WHERE email = $1",
      [identity.email],
      client,
    );
    if (!user) {
      user = await queryOne(
        "INSERT INTO users (email, name, avatar_url) VALUES ($1, $2, $3) RETURNING id, email, name",
        [identity.email, identity.name, identity.avatarUrl ?? null],
        client,
      );
    }
    if (!user) throw new Error("Failed to create user");
    await query(
      "INSERT INTO user_identities (user_id, provider, provider_uid) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [user.id, identity.provider, identity.providerUid],
      client,
    );
    return user;
  });
}

export async function findDefaultWorkspaceSlug(userId: string): Promise<string | null> {
  const row = await queryOne<{ slug: string }>(
    `SELECT w.slug FROM organization_members m
     JOIN workspaces w ON w.organization_id = m.organization_id
     WHERE m.user_id = $1 ORDER BY w.created_at ASC LIMIT 1`,
    [userId],
  );
  return row?.slug ?? null;
}
