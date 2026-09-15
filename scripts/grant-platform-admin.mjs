#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

for (const name of [".env.local", ".env"]) {
  const file = fileURLToPath(new URL("../" + name, import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
}
const [email, note, mode] = process.argv.slice(2);
if (!email || !note?.trim() || note.length > 500 || (mode && mode !== "--revoke") || process.argv.length > 5) {
  console.error('Usage: node scripts/grant-platform-admin.mjs EMAIL "reason" [--revoke]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await db.connect();
  await db.query("BEGIN");
  const { rows: [user] } = await db.query("SELECT id, email, disabled_at FROM users WHERE email = $1 FOR UPDATE", [email]);
  if (!user) throw new Error("Account not found");
  if (!mode && user.disabled_at) throw new Error("Restore the account before granting platform access");
  if (mode) {
    await db.query("UPDATE platform_admins SET revoked_at = now(), note = $2 WHERE user_id = $1", [user.id, note]);
  } else {
    await db.query(
      "INSERT INTO platform_admins (user_id, note) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET revoked_at = NULL, granted_at = now(), note = EXCLUDED.note",
      [user.id, note],
    );
  }
  await db.query(
    "INSERT INTO platform_audit_log (action, target_type, target_id, target_label, metadata) VALUES ($1, 'platform_admin', $2, $3, $4)",
    [mode ? "platform.admin.revoked" : "platform.admin.granted", user.id, user.email, { source: "operator_cli", reason: note }],
  );
  await db.query("COMMIT");
  console.log(mode ? "Platform grant revoked." : "Platform grant enabled.");
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  console.error(["Account not found", "Restore the account before granting platform access"].includes(error.message)
    ? error.message : "Could not update the platform grant. Check database connectivity and migration 0023.");
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
