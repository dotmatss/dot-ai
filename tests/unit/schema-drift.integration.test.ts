// @vitest-environment node
/**
 * Proves the TypeScript schema still describes the real database.
 *
 * `src/server/db/schema/` is a description of tables that already exist. It is
 * written by hand from the migration SQL, which means it can drift: a
 * migration adds a column, nobody updates the TypeScript, and from then on the
 * types lie. Every query built on them is then wrong in a way the compiler
 * cannot see.
 *
 * This test walks both sides and compares them. It is deliberately strict in
 * both directions - a column present in only one of them is a failure either
 * way.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/dot_dev" npx vitest run schema-drift
 */
import { is } from "drizzle-orm";
import { getTableConfig, isPgEnum, PgTable, type PgColumn, type PgEnum } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/server/db/schema";

const connectionString = process.env.DATABASE_URL;
const hasDatabase = Boolean(connectionString);

let client: pg.Client;

/**
 * Canonical name for a column type, so the two sides can be compared.
 *
 * PostgreSQL reports `udt_name` ("timestamptz", "int4", "_text"); Drizzle
 * reports SQL syntax ("timestamp with time zone", "integer", "text[]").
 */
const TYPE_ALIASES: Record<string, string> = {
  "timestamp with time zone": "timestamptz",
  "timestamp without time zone": "timestamp",
  timestamp: "timestamp",
  "double precision": "float8",
  integer: "int4",
  smallint: "int2",
  bigint: "int8",
  serial: "int4",
  bigserial: "int8",
  boolean: "bool",
  "character varying": "varchar",
  real: "float4",
};

function canonicalType(sqlType: string): string {
  const lower = sqlType.toLowerCase().trim();
  if (lower.endsWith("[]")) return `_${canonicalType(lower.slice(0, -2))}`;
  return TYPE_ALIASES[lower] ?? lower;
}

/**
 * Everything the schema barrel exports: tables, enums, and the `citext` column
 * helper. Widened to `unknown` so the guards below can narrow it - the union
 * of those export types is not a useful thing to write out.
 */
function exportedValues(): unknown[] {
  return Object.values(schema);
}

function describedTables(): Array<{ name: string; table: PgTable }> {
  // Drizzle's own runtime guards: a table is recognised by an internal brand,
  // not by its shape. Duck-typing here silently matches nothing, because
  // `$inferSelect` exists only in the type system.
  return exportedValues()
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => ({ name: getTableConfig(table).name, table }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function describedEnums(): Array<{ name: string; values: readonly string[] }> {
  return exportedValues()
    .filter((value): value is PgEnum<[string, ...string[]]> => isPgEnum(value))
    .map((value) => ({ name: value.enumName, values: value.enumValues }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface DbColumn {
  name: string;
  udtName: string;
  nullable: boolean;
}

const liveColumns = new Map<string, DbColumn[]>();
const liveEnums = new Map<string, string[]>();

beforeAll(async () => {
  if (!hasDatabase) return;
  client = new pg.Client({ connectionString });
  await client.connect();

  const columns = await client.query<{ table_name: string; column_name: string; udt_name: string; is_nullable: string }>(
    `SELECT table_name, column_name, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`,
  );
  for (const row of columns.rows) {
    const list = liveColumns.get(row.table_name) ?? [];
    list.push({ name: row.column_name, udtName: row.udt_name, nullable: row.is_nullable === "YES" });
    liveColumns.set(row.table_name, list);
  }

  const enums = await client.query<{ name: string; value: string }>(
    `SELECT t.typname AS name, e.enumlabel AS value
     FROM pg_type t
     JOIN pg_enum e ON e.enumtypid = t.oid
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
     ORDER BY t.typname, e.enumsortorder`,
  );
  for (const row of enums.rows) {
    liveEnums.set(row.name, [...(liveEnums.get(row.name) ?? []), row.value]);
  }
}, 30_000);

afterAll(async () => {
  if (client) await client.end();
});

describe.skipIf(!hasDatabase)("schema description matches the database", () => {
  it("describes at least the tables the migrations create", () => {
    expect(describedTables().length).toBeGreaterThanOrEqual(25);
  });

  it("names a table that actually exists", () => {
    const missing = describedTables()
      .map(({ name }) => name)
      .filter((name) => !liveColumns.has(name));
    expect(missing).toEqual([]);
  });

  it("describes every column of every table it claims, and no column it invented", () => {
    const problems: string[] = [];

    for (const { name, table } of describedTables()) {
      const live = liveColumns.get(name);
      if (!live) continue; // reported by the previous test

      const config = getTableConfig(table);
      const described = new Map<string, PgColumn>(config.columns.map((column) => [column.name, column]));
      const actual = new Map(live.map((column) => [column.name, column]));

      for (const columnName of actual.keys()) {
        if (!described.has(columnName)) problems.push(`${name}.${columnName} exists in the database but not in the schema`);
      }
      for (const columnName of described.keys()) {
        if (!actual.has(columnName)) problems.push(`${name}.${columnName} is described but does not exist`);
      }
    }

    expect(problems).toEqual([]);
  });

  it("agrees on the type of every column", () => {
    const problems: string[] = [];

    for (const { name, table } of describedTables()) {
      const live = liveColumns.get(name);
      if (!live) continue;
      const actual = new Map(live.map((column) => [column.name, column]));

      for (const column of getTableConfig(table).columns) {
        const real = actual.get(column.name);
        if (!real) continue;
        const described = canonicalType(column.getSQLType());
        if (described !== real.udtName) {
          problems.push(`${name}.${column.name}: schema says ${described}, database says ${real.udtName}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("agrees on which columns may be null", () => {
    const problems: string[] = [];

    for (const { name, table } of describedTables()) {
      const live = liveColumns.get(name);
      if (!live) continue;
      const actual = new Map(live.map((column) => [column.name, column]));

      for (const column of getTableConfig(table).columns) {
        const real = actual.get(column.name);
        if (!real) continue;
        // Drizzle's `notNull` and PostgreSQL's NOT NULL must agree, otherwise
        // the compiler will let a null through into a non-null column, or
        // force a null check that can never fire.
        if (column.notNull === real.nullable) {
          problems.push(
            `${name}.${column.name}: schema says ${column.notNull ? "NOT NULL" : "nullable"}, database says ${real.nullable ? "nullable" : "NOT NULL"}`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("agrees on every enum and its values, in order", () => {
    const problems: string[] = [];

    for (const { name, values } of describedEnums()) {
      const actual = liveEnums.get(name);
      if (!actual) {
        problems.push(`enum ${name} is described but does not exist`);
        continue;
      }
      // Order matters: it decides how `ORDER BY` sorts an enum column.
      if (actual.join(",") !== values.join(",")) {
        problems.push(`enum ${name}: schema has [${values.join(", ")}], database has [${actual.join(", ")}]`);
      }
    }

    expect(problems).toEqual([]);
  });

  it("does not leave a tenant table out of the description", () => {
    // Every table carrying workspace_id is tenant data. If one is missing from
    // the schema, a future query over it silently loses its types - and the
    // RLS convention test only covers what the database has, not what we typed.
    const described = new Set(describedTables().map(({ name }) => name));
    const missing: string[] = [];
    for (const [table, columns] of liveColumns) {
      if (table === "schema_migrations") continue;
      if (columns.some((column) => column.name === "workspace_id") && !described.has(table)) missing.push(table);
    }
    expect(missing).toEqual([]);
  });
});
