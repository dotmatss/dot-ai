// @vitest-environment node
/**
 * Firebase identities against a real PostgreSQL.
 *
 * `firebase-token-verification.test.ts` proves a token is what it claims to be.
 * This proves what the application then DOES with it, which is where the rest
 * of the risk lives: which row a UID resolves to, when an identity may adopt an
 * account that already exists, and whether any of it can be made to produce two
 * users where there should be one.
 *
 * Verification itself is stubbed here on purpose. Minting a token Google would
 * sign is impossible, and re-testing the verifier through a second door would
 * only prove it twice while making these cases harder to read. What the stub
 * hands back is exactly what a verified token yields: claims.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/dot_dev" pnpm exec vitest run firebase-identity
 *
 * Skipped when DATABASE_URL is absent, so the default suite stays hermetic.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { isApiError } from "@/lib/api/api-error";
import type * as VerifyModule from "@/server/auth/firebase/verify-id-token";

const connectionString = process.env.DATABASE_URL;
const suffix = Math.random().toString(36).slice(2, 10);
const domain = "rajahx.com";

/**
 * Stands in for a verified ID token.
 *
 * `verifyFirebaseIdToken` is given the token string and returns whatever claims
 * the case registered for it, so each test reads as "a token proving X arrives"
 * rather than as a mock setup.
 */
const claimsByToken = new Map<string, Record<string, unknown>>();
let tokenCounter = 0;

function tokenProving(claims: {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}): string {
  const token = `t${(tokenCounter += 1)}.${claims.uid}.stub`;
  claimsByToken.set(token, {
    uid: claims.uid,
    email: claims.email,
    emailVerified: claims.emailVerified,
    name: claims.name ?? "Test Person",
    picture: null,
    signInProvider: "password",
    issuedAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    authTime: Math.floor(Date.now() / 1000),
  });
  return token;
}

vi.mock("@/server/auth/firebase/verify-id-token", async (importOriginal) => {
  const actual = await importOriginal<typeof VerifyModule>();
  return {
    ...actual,
    isFirebaseConfigured: () => true,
    verifyFirebaseIdToken: async (token: string) => {
      const claims = claimsByToken.get(token);
      if (!claims) throw new actual.FirebaseTokenError("unknown stub token");
      return claims;
    },
  };
});

const { registerWithFirebase, signInWithFirebase, syncVerificationFromToken } = await import(
  "@/features/auth/server/firebase-auth-service"
);

let admin: pg.Client;

async function createLegacyUser(email: string, name: string, emailVerified = true): Promise<string> {
  const row = await admin.query<{ id: string }>(
    "INSERT INTO users (email, name, password_hash, email_verified) VALUES ($1, $2, 'x', $3) RETURNING id",
    [email, name, emailVerified],
  );
  return row.rows[0]!.id;
}

async function identityCount(userId: string): Promise<number> {
  const rows = await admin.query<{ count: string }>(
    "SELECT count(*) FROM user_identities WHERE user_id = $1 AND provider = 'firebase'",
    [userId],
  );
  return Number(rows.rows[0]!.count);
}

async function organizationCount(userId: string): Promise<number> {
  const rows = await admin.query<{ count: string }>("SELECT count(*) FROM organization_members WHERE user_id = $1", [userId]);
  return Number(rows.rows[0]!.count);
}

describe.skipIf(!connectionString)("Firebase identity mapping", () => {
  const created: string[] = [];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString });
    await admin.connect();
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    for (const slug of created) {
      await admin.query("DELETE FROM organizations WHERE slug = $1", [slug]).catch(() => undefined);
    }
    await admin.query("DELETE FROM users WHERE email LIKE $1", [`%-${suffix}@${domain}`]).catch(() => undefined);
    await admin.end().catch(() => undefined);
  });

  describe("registration", () => {
    it("creates the user, the link, the organization and the workspace", async () => {
      const email = `new-${suffix}@${domain}`;
      const token = tokenProving({ uid: `uid-new-${suffix}`, email, emailVerified: false });

      const result = await registerWithFirebase({ idToken: token, name: "New Person", organizationName: `New Org ${suffix}` });
      created.push(result.workspaceSlug);

      const rows = await admin.query<{ id: string; email: string; email_verified: boolean; password_hash: string | null }>(
        "SELECT id, email, email_verified, password_hash FROM users WHERE email = $1",
        [email],
      );
      const user = rows.rows[0]!;
      expect(user.email).toBe(email);
      // Unverified until Firebase says otherwise - §4 step 8.
      expect(user.email_verified).toBe(false);
      // §3: Firebase owns the password, so there is nothing to store here.
      expect(user.password_hash).toBeNull();

      const link = await admin.query<{ provider_uid: string }>(
        "SELECT provider_uid FROM user_identities WHERE user_id = $1 AND provider = 'firebase'",
        [user.id],
      );
      expect(link.rows[0]!.provider_uid).toBe(`uid-new-${suffix}`);
      expect(await organizationCount(user.id)).toBe(1);
    });

    /**
     * The retry case, and the expensive one to get wrong: a second call must
     * not produce a second organization. A duplicate user is annoying; a
     * duplicate tenant owns workspaces, members and data.
     */
    it("is idempotent - a repeated registration creates no second organization", async () => {
      const email = `retry-${suffix}@${domain}`;
      const uid = `uid-retry-${suffix}`;
      const first = await registerWithFirebase({
        idToken: tokenProving({ uid, email, emailVerified: false }),
        name: "Retry Person",
        organizationName: `Retry Org ${suffix}`,
      });
      created.push(first.workspaceSlug);

      const second = await registerWithFirebase({
        idToken: tokenProving({ uid, email, emailVerified: false }),
        name: "Retry Person",
        organizationName: `Retry Org ${suffix}`,
      });

      expect(second.workspaceSlug).toBe(first.workspaceSlug);
      expect(second.user.id).toBe(first.user.id);
      expect(await organizationCount(first.user.id)).toBe(1);
      expect(await identityCount(first.user.id)).toBe(1);

      const count = await admin.query<{ count: string }>("SELECT count(*) FROM users WHERE email = $1", [email]);
      expect(Number(count.rows[0]!.count)).toBe(1);
    });
  });

  describe("linking to an account that already exists", () => {
    /**
     * The account-takeover case. Anyone can create a Firebase account claiming
     * an address they do not own - Firebase only demands proof before marking
     * it verified - so an unverified identity must never reach an existing
     * account.
     */
    it("refuses an unverified identity for an address that already has an account", async () => {
      const email = `victim-${suffix}@${domain}`;
      await createLegacyUser(email, "Victim");

      const token = tokenProving({ uid: `uid-attacker-${suffix}`, email, emailVerified: false });

      await expect(
        registerWithFirebase({ idToken: token, name: "Attacker", organizationName: `Stolen ${suffix}` }),
      ).rejects.toSatisfy((error: unknown) => isApiError(error) && error.status === 403);
    });

    it("links a verified identity to the account it belongs to, without creating a second one", async () => {
      const email = `migrating-${suffix}@${domain}`;
      const legacyId = await createLegacyUser(email, "Migrating Person");

      const result = await signInWithFirebase(tokenProving({ uid: `uid-migrating-${suffix}`, email, emailVerified: true }));

      expect(result.user.id).toBe(legacyId);
      expect(await identityCount(legacyId)).toBe(1);
      const count = await admin.query<{ count: string }>("SELECT count(*) FROM users WHERE email = $1", [email]);
      expect(Number(count.rows[0]!.count)).toBe(1);
    });

    /**
     * After the first link, the UID is the key and the address is not read at
     * all - which is what stops a changed address in Firebase from moving an
     * application account to somebody else.
     */
    it("matches on the provider UID once linked, even if the address changes", async () => {
      const email = `stable-${suffix}@${domain}`;
      const uid = `uid-stable-${suffix}`;
      const legacyId = await createLegacyUser(email, "Stable Person");
      await signInWithFirebase(tokenProving({ uid, email, emailVerified: true }));

      const result = await signInWithFirebase(
        tokenProving({ uid, email: `renamed-${suffix}@${domain}`, emailVerified: true }),
      );

      expect(result.user.id).toBe(legacyId);
      expect(result.user.email).toBe(email);
    });
  });

  describe("sign-in", () => {
    /**
     * §9: a Firebase account with no application account is handled, not
     * quietly turned into a new tenant.
     */
    it("refuses a Firebase account that has no application user", async () => {
      const token = tokenProving({ uid: `uid-stranger-${suffix}`, email: `stranger-${suffix}@${domain}`, emailVerified: true });

      await expect(signInWithFirebase(token)).rejects.toSatisfy((error: unknown) => isApiError(error) && error.status === 403);
    });

    /**
     * §12: authenticating with Firebase is not the same as being authorized
     * here. A disabled account presents a perfectly good token and still gets
     * nowhere.
     */
    it("refuses a linked account that has been disabled in PostgreSQL", async () => {
      const email = `disabled-${suffix}@${domain}`;
      const uid = `uid-disabled-${suffix}`;
      const userId = await createLegacyUser(email, "Disabled Person");
      await signInWithFirebase(tokenProving({ uid, email, emailVerified: true }));

      await admin.query("UPDATE users SET disabled_at = now(), disabled_reason = 'test' WHERE id = $1", [userId]);

      await expect(signInWithFirebase(tokenProving({ uid, email, emailVerified: true }))).rejects.toSatisfy(
        (error: unknown) => isApiError(error) && error.status === 401,
      );
    });
  });

  describe("verification mirroring", () => {
    it("writes the provider's verification state into PostgreSQL, in both directions", async () => {
      const email = `verify-${suffix}@${domain}`;
      const uid = `uid-verify-${suffix}`;
      const registered = await registerWithFirebase({
        idToken: tokenProving({ uid, email, emailVerified: false }),
        name: "Verify Person",
        organizationName: `Verify Org ${suffix}`,
      });
      created.push(registered.workspaceSlug);

      const verified = await syncVerificationFromToken(tokenProving({ uid, email, emailVerified: true }));
      expect(verified.emailVerified).toBe(true);
      expect(await verifiedFlag(registered.user.id)).toBe(true);

      // Firebase resets verification when an address changes, so the mirror
      // has to follow it down as well as up.
      const unverified = await syncVerificationFromToken(tokenProving({ uid, email, emailVerified: false }));
      expect(unverified.emailVerified).toBe(false);
      expect(await verifiedFlag(registered.user.id)).toBe(false);
    });

    it("refuses to mirror for a UID with no application user", async () => {
      const token = tokenProving({ uid: `uid-nobody-${suffix}`, email: `nobody-${suffix}@${domain}`, emailVerified: true });

      await expect(syncVerificationFromToken(token)).rejects.toSatisfy(
        (error: unknown) => isApiError(error) && error.status === 401,
      );
    });
  });

  /**
   * The fallback path, which has no Firebase at all.
   *
   * Here because the verification gate is what makes it a security-relevant
   * question, and because getting it wrong is silent and total: an account
   * created unverified on a path that cannot verify anything is redirected to
   * /verify-email forever, where there is no Firebase identity to refresh. That
   * is a locked-out deployment, not a stricter one.
   */
  describe("the built-in password path", () => {
    it("creates accounts that are already verified, because nothing there can verify them", async () => {
      const email = `password-${suffix}@${domain}`;
      const { registerUser } = await import("@/features/auth/server/auth-service");

      const result = await registerUser({
        email,
        name: "Password Person",
        password: "a-sufficiently-long-password",
        organizationName: `Password Org ${suffix}`,
      });
      created.push(result.workspaceSlug);

      expect(await verifiedFlag(result.user.id)).toBe(true);
    });
  });

  async function verifiedFlag(userId: string): Promise<boolean> {
    const rows = await admin.query<{ email_verified: boolean }>("SELECT email_verified FROM users WHERE id = $1", [userId]);
    return rows.rows[0]!.email_verified;
  }
});
