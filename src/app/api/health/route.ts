import { NextResponse } from "next/server";

import { pingDatabase } from "@/server/db/client";

/**
 * Liveness/readiness probe. Deliberately reveals no configuration details.
 *
 * `schema` is reported separately from `database` because a reachable database
 * with no tables in it is not a healthy deployment, and used to look like one:
 * the check was `SELECT version()`, which an empty database answers happily,
 * so CI's smoke test went green over a deployment where nobody could sign in.
 *
 * Both are failures, so both return 503 - this endpoint is what a deploy gates
 * on, and "reachable but unusable" is not something to pass.
 *
 * `"missing"` is as much as it will say. That a schema has not been migrated is
 * an operator's problem, not a fact to publish to anyone who curls the URL, and
 * naming tables or migrations here would describe the database to strangers.
 */
export async function GET() {
  const db = await pingDatabase();
  const healthy = db.ok && db.schema;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: {
        database: db.ok ? "ok" : "unavailable",
        schema: db.schema ? "ok" : "missing",
      },
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
