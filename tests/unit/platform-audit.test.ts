// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
const withDb = vi.hoisted(() => vi.fn());
vi.mock("@/server/db/client", () => ({ withDb }));
import { redactMetadata, recordPlatformAudit } from "@/server/platform/platform-audit";
describe("platform audit", () => {
  it("redacts credentials across nesting and separator conventions", () => {
    expect(redactMetadata({ api_key: "secret", private_key: "secret", nested: [{ "API-Key": "secret", safe: 2 }] }))
      .toEqual({ api_key: "[redacted]", private_key: "[redacted]", nested: [{ "API-Key": "[redacted]", safe: 2 }] });
  });
  it("propagates failures inside a mutation transaction", async () => {
    withDb.mockRejectedValue(new Error("insert failed"));
    await expect(recordPlatformAudit({ actorId: null, actorEmail: null, action: "test", targetType: "test" }, {} as PoolClient))
      .rejects.toThrow("insert failed");
  });
  it("keeps denial logging best effort without logging database error details", async () => {
    withDb.mockRejectedValue(new Error("sensitive database details"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordPlatformAudit({ actorId: null, actorEmail: null, action: "test", targetType: "test" })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[platform-audit] failed to record", { action: "test" });
    log.mockRestore();
  });
});
