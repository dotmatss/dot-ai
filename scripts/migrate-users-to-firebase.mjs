#!/usr/bin/env node
/**
 * Imports existing PostgreSQL accounts into Firebase Authentication.
 *
 *   node scripts/migrate-users-to-firebase.mjs --dry-run   report what would happen
 *   node scripts/migrate-users-to-firebase.mjs             import
 *   node scripts/migrate-users-to-firebase.mjs --link-only link already-imported users
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * `users` already holds accounts, and Firebase does not know about any of them.
 * This walks the table and creates the matching Firebase account for each one,
 * CARRYING THE EXISTING PASSWORD, so nobody has to reset anything.
 *
 * That last part is the reason the script exists rather than a paragraph in the
 * runbook saying "tell everyone to reset". `src/server/auth/password.ts` hashes
 * with Node's scrypt at N=16384, r=8, p=1, 64-byte output, and Firebase's
 * `importUsers` accepts exactly that under `STANDARD_SCRYPT`. The hash is
 * carried across as bytes; the password itself is not known to this script, to
 * Firebase, or to anyone running it.
 *
 * ── Why firebase-admin here and nowhere else ────────────────────────────────
 *
 * `importUsers` is a privileged operation and needs a service-account
 * credential. That credential must never reach the application - see
 * `src/config/firebase.ts` - and `firebase-admin` cannot run on Cloudflare
 * Workers anyway. So it lives in a devDependency used by this script, on Node,
 * run by a person, and `src/` imports neither.
 *
 * ── Accounts with no password ───────────────────────────────────────────────
 *
 * A row with `password_hash IS NULL` has no credential to carry. It is created
 * in Firebase without one, which is a usable account the moment its owner uses
 * "Forgot password" - and is NOT a way in for anyone else, because an account
 * with no password cannot be signed in to.
 *
 * ── Idempotent ──────────────────────────────────────────────────────────────
 *
 * Safe to re-run. `importUsers` is an upsert on the UID, the UIDs are derived
 * deterministically from `users.id`, and the `user_identities` link is written
 * with ON CONFLICT DO NOTHING. A partial run is finished by running it again.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import admin from "firebase-admin";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Already loaded or unreadable; process.env wins.
    }
  }
}

const dryRun = process.argv.includes("--dry-run");
const linkOnly = process.argv.includes("--link-only");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
// Only the real run needs a credential. A dry run reads PostgreSQL and nothing
// else, which is what makes it useful before the Firebase project even exists -
// it answers "how many accounts carry a password, and how many will need a
// reset" while that answer can still change the plan.
if (!dryRun && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error(
    "No Firebase Admin credential found.\n" +
      "Set GOOGLE_APPLICATION_CREDENTIALS to the path of a service-account JSON file downloaded from\n" +
      "Firebase Console -> Project settings -> Service accounts. Never commit that file.",
  );
  process.exit(1);
}

/**
 * Firebase's scrypt parameters, expressed the way `importUsers` wants them.
 *
 * The mapping is the fiddly part and is worth stating explicitly, because
 * getting it wrong does not fail loudly - it produces accounts whose passwords
 * simply never match:
 *
 *   ours          Firebase              value
 *   N = 16384     memoryCost = log2(N)  14
 *   r = 8         blockSize             8
 *   p = 1         parallelization       1
 *   keylen = 64   derivedKeyLength      64
 *
 * `memoryCost` is the EXPONENT, not N. Passing 16384 there would be wrong by a
 * factor of a thousand and would quietly break every imported password.
 */
const SCRYPT_PARAMS = { memoryCost: 14, blockSize: 8, parallelization: 1, derivedKeyLength: 64 };

/**
 * A stable Firebase UID for an application user.
 *
 * Derived from `users.id` rather than random so that re-running this script
 * targets the same Firebase account instead of creating a second one, and so a
 * half-finished run can be completed rather than unpicked.
 *
 * Firebase UIDs must be at most 128 characters and are compared as strings; a
 * UUID with the dashes removed is well inside that. The application never
 * assumes the two ids are related - it resolves Firebase UID -> user_identities
 * -> users.id like any other provider - so this is a convenience for the
 * migration, not a coupling.
 */
function firebaseUidFor(userId) {
  return `pg_${userId.replace(/-/g, "")}`;
}

/**
 * Splits `scrypt$N$r$p$salt$hash` into the two byte strings Firebase wants.
 *
 * Returns null for a hash whose parameters are not the ones Firebase is being
 * told to use. That check matters: if `password.ts` ever raises its work
 * factor, rows written afterwards would carry different parameters, and
 * importing them under the old ones would silently produce accounts that reject
 * the correct password. Such rows are skipped and reported instead.
 */
function parseScryptHash(stored) {
  const [scheme, n, r, p, saltB64, hashB64] = String(stored).split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return null;
  if (Number(n) !== 2 ** SCRYPT_PARAMS.memoryCost || Number(r) !== SCRYPT_PARAMS.blockSize || Number(p) !== SCRYPT_PARAMS.parallelization) {
    return null;
  }
  return { salt: Buffer.from(saltB64, "base64"), hash: Buffer.from(hashB64, "base64") };
}

const client = new pg.Client({ connectionString });

async function main() {
  await client.connect();

  const { rows: users } = await client.query(
    `SELECT u.id, u.email, u.name, u.password_hash, u.email_verified, u.disabled_at,
            i.provider_uid AS existing_uid
       FROM users u
       LEFT JOIN user_identities i ON i.user_id = u.id AND i.provider = 'firebase'
      ORDER BY u.created_at`,
  );

  console.log(`${users.length} application user(s) found.`);

  const toImport = [];
  const skipped = [];
  for (const user of users) {
    if (user.existing_uid) {
      skipped.push({ email: user.email, reason: "already linked to Firebase" });
      continue;
    }
    const uid = firebaseUidFor(user.id);
    const record = {
      uid,
      email: user.email,
      displayName: user.name,
      // Carried across rather than reset to false. These accounts were
      // grandfathered as verified by migration 0029, and importing them as
      // unverified would lock them out of the application on their first
      // Firebase sign-in - the exact interruption the grandfathering avoided.
      emailVerified: user.email_verified === true,
      // A disabled application account is disabled in Firebase too, so it
      // cannot even authenticate. The application would refuse it anyway
      // (`users.disabled_at`), and this makes the two agree.
      disabled: user.disabled_at !== null,
    };

    if (user.password_hash) {
      const parsed = parseScryptHash(user.password_hash);
      if (!parsed) {
        skipped.push({ email: user.email, reason: "password hash uses unexpected scrypt parameters - will need a reset" });
      } else {
        record.passwordHash = parsed.hash;
        record.passwordSalt = parsed.salt;
      }
    }
    toImport.push({ record, userId: user.id, uid, hasPassword: Boolean(record.passwordHash) });
  }

  const withPassword = toImport.filter((entry) => entry.hasPassword).length;
  console.log(`  ${toImport.length} to import (${withPassword} with a password, ${toImport.length - withPassword} will need "Forgot password")`);
  console.log(`  ${skipped.length} skipped`);
  for (const entry of skipped) console.log(`    - ${entry.email}: ${entry.reason}`);

  if (dryRun) {
    console.log("\nDry run: nothing was written to Firebase or PostgreSQL.");
    return;
  }
  if (toImport.length === 0) return;

  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const auth = admin.auth();

  if (!linkOnly) {
    // 1000 is Firebase's documented per-call ceiling.
    for (let offset = 0; offset < toImport.length; offset += 1000) {
      const batch = toImport.slice(offset, offset + 1000);
      const result = await auth.importUsers(
        batch.map((entry) => entry.record),
        { hash: { algorithm: "STANDARD_SCRYPT", ...SCRYPT_PARAMS } },
      );
      console.log(`Imported ${result.successCount}, failed ${result.failureCount}`);
      for (const failure of result.errors) {
        console.error(`  ! ${batch[failure.index]?.record.email}: ${failure.error.message}`);
      }
    }
  }

  /*
   * The link rows.
   *
   * Written here rather than left to first sign-in so that the migration is
   * finished when the script finishes, and so `--dry-run` can report a number
   * that means something. First sign-in would also work - that is the
   * `linked-existing-account` path - but it would leave the two systems
   * disagreeing for as long as a user stayed away, and a support question in
   * the meantime would have no good answer.
   */
  let linked = 0;
  for (const entry of toImport) {
    const { rowCount } = await client.query(
      `INSERT INTO user_identities (user_id, provider, provider_uid)
       VALUES ($1, 'firebase', $2)
       ON CONFLICT (provider, provider_uid) DO NOTHING`,
      [entry.userId, entry.uid],
    );
    linked += rowCount ?? 0;
  }
  console.log(`Linked ${linked} user_identities row(s).`);

  console.log(
    "\nDone. Users with a carried-over password sign in with the password they already had.\n" +
      'Users without one must use "Forgot password" once.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
