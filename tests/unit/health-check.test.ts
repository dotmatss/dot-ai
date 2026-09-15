// @vitest-environment node
/**
 * The health endpoint, pinned to the failure it missed.
 *
 * This exists because of a real incident rather than for coverage. `/api/health`
 * checked connectivity with `SELECT version()`, a Worker was deployed against a
 * Supabase project whose migrations had never been run, and the endpoint
 * answered `{"database":"ok"}` - so CI's smoke test went green, the deploy was
 * declared successful, and the first person to open the sign-in page got
 * "Something went wrong" from a failed `SELECT ... FROM users`.
 *
 * The lesson is narrow and worth holding: a reachable database is not a usable
 * one, and a probe that cannot tell the two apart will certify an outage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ping: vi.fn() }));
vi.mock("@/server/db/client", () => ({ pingDatabase: mocks.ping }));

const { GET } = await import("@/app/api/health/route");

describe("/api/health", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is ok only when the database is reachable AND the schema is there", async () => {
    mocks.ping.mockResolvedValue({ ok: true, version: "PostgreSQL 17", schema: true });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      checks: { database: "ok", schema: "ok" },
    });
  });

  /** The incident, as a test. */
  it("fails a reachable database whose schema was never migrated", async () => {
    mocks.ping.mockResolvedValue({ ok: true, version: "PostgreSQL 17", schema: false });

    const response = await GET();

    // 503, not 200: the deploy gate reads this, and "reachable but unusable"
    // must not pass it.
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      checks: { database: "ok", schema: "missing" },
    });
  });

  it("reports an unreachable database separately, because the fix is different", async () => {
    mocks.ping.mockResolvedValue({ ok: false, error: "connection refused", schema: false });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      checks: { database: "unavailable", schema: "missing" },
    });
  });

  /**
   * The endpoint is public and unauthenticated, so what it declines to say
   * matters as much as what it says.
   */
  it("discloses no connection details, table names or error text", async () => {
    mocks.ping.mockResolvedValue({ ok: false, error: "no pg_hba.conf entry for host 10.1.2.3, user dot_app", schema: false });

    const body = JSON.stringify(await (await GET()).json());

    expect(body).not.toContain("pg_hba");
    expect(body).not.toContain("10.1.2.3");
    expect(body).not.toContain("dot_app");
    expect(body).not.toContain("users");
  });
});
