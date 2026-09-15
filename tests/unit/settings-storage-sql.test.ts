// @vitest-environment node
/**
 * The storage totals are the one place this repository interpolates a whole
 * table into a `sql` fragment. `pg_column_size(<table>)` is a whole-row
 * reference, and it is only valid if Drizzle renders the table itself rather
 * than a column list or an alias, so the shape is asserted here instead of
 * being discovered on the Storage page.
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import { knowledgeChunks } from "@/server/db/schema";

// No pool is created and nothing connects: `toSQL()` only renders.
const db = drizzle.mock();

describe("storage row-size query", () => {
  it("renders pg_column_size against the table, not a column", () => {
    const { sql: text } = db
      .select({
        bytes: sql<number>`coalesce(sum(pg_column_size(${knowledgeChunks})), 0)`.mapWith(Number),
        rows: sql<number>`count(*)`.mapWith(Number),
      })
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.workspaceId, "00000000-0000-0000-0000-000000000000"))
      .toSQL();

    expect(text).toContain('pg_column_size("knowledge_chunks")');
    expect(text).toContain('from "knowledge_chunks"');
    expect(text).toContain('"workspace_id" = $1');
  });
});
