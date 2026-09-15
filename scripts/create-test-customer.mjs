#!/usr/bin/env node
/**
 * Creates a CUSTOMER account for development and testing.
 *
 *   node scripts/create-test-customer.mjs owner@rajahx.com "Olivia Owner" owner
 *   node scripts/create-test-customer.mjs member@rajahx.com "Marco Member" member --org "Rajahx Test"
 *
 * The opposite of `create-platform-operator.mjs`: this account belongs to an
 * organization and holds a role inside it, and it gets NO platform grant. It is
 * what a real customer looks like, which is what makes it the right thing to
 * point at the platform boundary - an organization `owner` who still cannot
 * reach /admin is the claim worth being able to check by hand.
 *
 * The real product path for this is /sign-up (and an invitation for the
 * non-owner roles). This exists so a role can be created directly without
 * driving the UI, not because the UI path is wrong.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 *
 * Development only, and it refuses to run with NODE_ENV=production, exactly as
 * scripts/seed.mjs does. It creates an identity and a membership and nothing
 * else: no chatbots, no knowledge, no conversations. `scripts/seed.mjs` is
 * still the thing to run when a workspace full of realistic data is wanted.
 *
 * The password is never read from argv - arguments land in shell history and
 * are visible through `ps`. Supply CUSTOMER_PASSWORD, or let one be generated
 * and printed exactly once.
 */
import { existsSync } from "node:fs";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { fileURLToPath } from "node:url";

import pg from "pg";

for (const name of [".env.local", ".env"]) {
  const file = fileURLToPath(new URL("../" + name, import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to create test accounts in production.");
  process.exit(1);
}

const ROLES = ["owner", "admin", "member", "viewer"];
const args = process.argv.slice(2);
const orgFlag = args.indexOf("--org");
const orgName = orgFlag === -1 ? "Rajahx Test" : args[orgFlag + 1];
const [email, name, role = "owner"] = orgFlag === -1 ? args : args.slice(0, orgFlag);

if (!email?.includes("@") || !name?.trim() || !ROLES.includes(role) || !orgName?.trim()) {
  console.error('Usage: node scripts/create-test-customer.mjs EMAIL "Full Name" [owner|admin|member|viewer] [--org "Org Name"]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const password = process.env.CUSTOMER_PASSWORD ?? randomBytes(18).toString("base64url");
const generated = !process.env.CUSTOMER_PASSWORD;
// Mirrors src/features/auth/schemas.ts so the account can actually sign in.
if (password.length < 8 || password.length > 128) {
  console.error("CUSTOMER_PASSWORD must be between 8 and 128 characters");
  process.exit(1);
}

/** Must match src/server/auth/password.ts, as scripts/seed.mjs also does. */
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

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await db.connect();
  await db.query("BEGIN");

  const { rows: existing } = await db.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.length > 0) throw new Error("ACCOUNT_EXISTS");

  // Reuse the organization when it is already there, so running this twice
  // puts two roles in ONE tenant rather than creating a second one - which is
  // the arrangement that makes role differences testable.
  const orgSlug = slugify(orgName);
  let { rows: [org] } = await db.query("SELECT id FROM organizations WHERE slug = $1", [orgSlug]);
  let workspaceSlug;

  if (org) {
    const { rows: [ws] } = await db.query(
      "SELECT slug FROM workspaces WHERE organization_id = $1 ORDER BY created_at LIMIT 1",
      [org.id],
    );
    workspaceSlug = ws?.slug;
  } else {
    ({ rows: [org] } = await db.query(
      "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
      [orgName, orgSlug],
    ));
    workspaceSlug = `${orgSlug}-ws`;
    await db.query("INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3)", [
      org.id,
      `${orgName} Workspace`,
      workspaceSlug,
    ]);
  }

  const { rows: [user] } = await db.query(
    "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id",
    [email, name.trim(), await hashPassword(password)],
  );
  await db.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)", [
    org.id,
    user.id,
    role,
  ]);

  // Deliberately NO platform_admins row and no platform_audit_log entry: this
  // is an ordinary customer, and creating one is not a platform action.
  await db.query("COMMIT");

  console.log("Test customer created.");
  console.log(`  Email:        ${email}`);
  if (generated) console.log(`  Password:     ${password}   (shown once)`);
  console.log(`  Organization: ${orgName}`);
  console.log(`  Role:         ${role}`);
  console.log(`  Lands on:     /w/${workspaceSlug}/dashboard`);
  console.log("  Not a platform admin: /admin returns 404 for this account.");
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  if (error.message === "ACCOUNT_EXISTS") {
    console.error("An account with that email already exists.");
  } else {
    console.error("Could not create the test customer. Check database connectivity and that migrations are applied.");
  }
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
