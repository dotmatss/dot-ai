#!/usr/bin/env node
/**
 * Creates a dedicated PLATFORM OPERATOR account and grants it the platform
 * boundary, in one transaction.
 *
 *   node scripts/create-platform-operator.mjs ops@example.com "Jane Ops" "Initial platform operator"
 *
 * ── Why this is separate from grant-platform-admin.mjs ──────────────────────
 *
 * That script grants the boundary to an account that already exists, and
 * deliberately never creates one. This creates an identity. Keeping them apart
 * means "who may operate the platform" and "who exists" stay two decisions, and
 * the grant script keeps its useful property of being unable to invent a
 * principal.
 *
 * ── Why a separate operator account at all ──────────────────────────────────
 *
 * So the identity that operates the SaaS is not the identity that uses it as a
 * customer. An operator account joins NO organization: it has no workspace, no
 * data and no customer role, so a mistake made while signed in as an operator
 * cannot be a mistake inside a tenant, and the platform audit trail names a
 * principal that does nothing else.
 *
 * ── Password handling ───────────────────────────────────────────────────────
 *
 * The password is NEVER read from argv. Command-line arguments land in shell
 * history and are visible to every process on the machine through `ps`, which
 * is not where a credential belongs. Supply it in OPERATOR_PASSWORD, or let one
 * be generated - it is then printed exactly once and never stored in clear.
 */
import { existsSync } from "node:fs";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { fileURLToPath } from "node:url";

import pg from "pg";

for (const name of [".env.local", ".env"]) {
  const file = fileURLToPath(new URL("../" + name, import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
}

const [email, name, note] = process.argv.slice(2);
if (!email || !email.includes("@") || !name?.trim() || !note?.trim() || note.length > 500 || process.argv.length > 5) {
  console.error('Usage: node scripts/create-platform-operator.mjs EMAIL "Full Name" "reason"');
  console.error("Optional: OPERATOR_PASSWORD=... (otherwise one is generated and printed once)");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const password = process.env.OPERATOR_PASSWORD ?? randomBytes(18).toString("base64url");
const generated = !process.env.OPERATOR_PASSWORD;
// Mirrors src/features/auth/schemas.ts, so an account this creates can actually sign in.
if (password.length < 8 || password.length > 128) {
  console.error("OPERATOR_PASSWORD must be between 8 and 128 characters");
  process.exit(1);
}

/** Must match src/server/auth/password.ts, exactly as scripts/seed.mjs does. */
function hashPassword(plain) {
  const params = { N: 16384, r: 8, p: 1 };
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scryptCallback(plain.normalize("NFKC"), salt, 64, params, (error, derived) => {
      if (error) reject(error);
      else resolve(["scrypt", params.N, params.r, params.p, salt.toString("base64"), derived.toString("base64")].join("$"));
    });
  });
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
let created = false;

try {
  await db.connect();
  await db.query("BEGIN");

  // `users.email` is citext, so this comparison is case-insensitive like the
  // unique index that backs it up if two runs race.
  const { rows: existing } = await db.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.length > 0) {
    throw new Error("ACCOUNT_EXISTS");
  }

  const passwordHash = await hashPassword(password);
  const { rows: [user] } = await db.query(
    // Verified by construction: whoever ran this script has database access and
    // chose the address, so there is nobody left for a confirmation email to
    // convince. Explicit because `email_verified` defaults to false (0029), and
    // an unverified operator would be bounced to /verify-email with no Firebase
    // identity to verify against.
    "INSERT INTO users (email, name, password_hash, email_verified) VALUES ($1, $2, $3, true) RETURNING id",
    [email, name.trim(), passwordHash],
  );

  // No organization_members row is written, and that omission is the feature.
  await db.query("INSERT INTO platform_admins (user_id, note) VALUES ($1, $2)", [user.id, note]);

  // Two records: the identity appearing, and the boundary being granted. They
  // are different facts and are asked about separately after an incident.
  await db.query(
    `INSERT INTO platform_audit_log (action, target_type, target_id, target_label, metadata)
     VALUES ($1, 'user', $2, $3, $4), ($5, 'platform_admin', $2, $3, $6)`,
    [
      "user.created",
      user.id,
      email,
      { source: "operator_cli", reason: note, organizationMemberships: 0 },
      "platform.admin.granted",
      { source: "operator_cli", reason: note, passwordSource: generated ? "generated" : "supplied" },
    ],
  );

  await db.query("COMMIT");
  created = true;

  console.log("Platform operator created.");
  console.log(`  Email: ${email}`);
  if (generated) {
    console.log(`  Password: ${password}`);
    console.log("  Shown once and not stored in clear. Save it now, then change it after first sign-in.");
  }
  console.log("  This account belongs to no organization. Sign in and go to /admin.");
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  if (error.message === "ACCOUNT_EXISTS") {
    console.error("An account with that email already exists.");
    console.error(`Grant it the platform boundary instead:\n  node scripts/grant-platform-admin.mjs ${email} "${note}"`);
  } else {
    // Database error text can carry connection strings and statement fragments.
    console.error("Could not create the platform operator. Check database connectivity and migration 0023.");
  }
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}

if (!created) process.exitCode = process.exitCode ?? 1;
