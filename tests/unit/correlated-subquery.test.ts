// @vitest-environment node
/**
 * Keeps correlated subqueries composed rather than hand-written.
 *
 * ── The bug this exists to prevent ──────────────────────────────────────────
 *
 * Drizzle renders an interpolated column inside a `sql` template WITHOUT its
 * table name when the enclosing query has no join. In a correlated subquery
 * that is silently catastrophic:
 *
 *   sql`(SELECT count(*) FROM ${contactNotes}
 *        WHERE ${contactNotes.contactId} = ${contacts.id})`
 *
 * renders as
 *
 *   (SELECT count(*) FROM "contact_notes" WHERE "contact_id" = "id")
 *
 * Both names now resolve against `contact_notes` itself, so the subquery
 * compares a row to itself and counts nothing. No error, no warning - every
 * count just comes back 0, or worse, plausible but wrong. This shipped once and
 * was caught only by an integration test asserting a note count.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * Build subqueries with the query builder and interpolate the RESULT:
 *
 *   sql`${qb.select({ c: sql`count(*)` }).from(contactNotes)
 *           .where(eq(contactNotes.contactId, contacts.id))}`
 *
 * The builder always qualifies, join or no join. This test fails on any `sql`
 * template that opens its own subquery over an interpolated table, which is the
 * shape that can reintroduce the bug.
 *
 * It reads the source rather than the SQL because the selections are private to
 * their modules, and because the failure has no runtime symptom to assert on -
 * the same reasoning as `platform-isolation` and `ai-registry`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const absolute = path.join(root, dir);
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const relative = path.join(dir, entry);
    if (statSync(path.join(root, relative)).isDirectory()) {
      out.push(...sourceFiles(relative));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(relative);
    }
  }
  return out;
}

/**
 * A `sql` tagged template that contains `FROM ${...}` - an interpolated table
 * inside a subquery it wrote by hand. `sql.raw` and plain strings handed to
 * `query()` are untouched: those are the classified raw statements, which name
 * their tables and aliases explicitly and are not built from schema objects.
 */
const HAND_WRITTEN_SUBQUERY = /sql(?:<[^>]*>)?`[^`]*\bFROM\s+\$\{/i;

describe("correlated subqueries", () => {
  it("are composed with the query builder, never written inside a sql template", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles("src")) {
      const raw = readFileSync(path.join(root, file), "utf8");
      // Comments are stripped first: this file and several repositories explain
      // the bug by quoting the very shape being banned.
      const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

      for (const line of source.split("\n")) {
        if (HAND_WRITTEN_SUBQUERY.test(line)) offenders.push(`${file}: ${line.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
