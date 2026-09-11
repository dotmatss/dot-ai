import { NextResponse } from "next/server";

import { pingDatabase } from "@/server/db/client";

/** Liveness/readiness probe. Deliberately reveals no configuration details. */
export async function GET() {
  const db = await pingDatabase();
  const status = db.ok ? "ok" : "degraded";
  return NextResponse.json(
    { status, checks: { database: db.ok ? "ok" : "unavailable" } },
    { status: db.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
