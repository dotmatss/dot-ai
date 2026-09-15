// @vitest-environment node
/**
 * Rules of the platform mutations, and of the runtime lifecycle guards.
 *
 * The repository, the audit writer and the transaction are mocked: what is
 * under test is the DECISIONS the service makes - what it refuses, what it
 * records, and what it does before it starts writing. Whether the SQL is
 * correct is settled by `platform-lifecycle.integration.test.ts` against a real
 * database, not by asserting against a fake one here.
 *
 * The actor is passed in rather than resolved inside the service, matching
 * every other service in this codebase: `platformRoute` has already
 * authenticated and authorized, and re-deriving the actor in the service would
 * be a second implementation of one security decision.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  grant: vi.fn(),
  audit: vi.fn(),
  setUser: vi.fn(),
  setOrg: vi.fn(),
  identity: vi.fn(),
  org: vi.fn(),
  sessions: vi.fn(),
  transaction: vi.fn(),
  orgDetail: vi.fn(),
  userDetail: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({ withDb: mocks.db, withTransaction: mocks.transaction }));
// Mocked so the peer check is a decision this test controls, and so the React
// `cache()` wrapper on the real grant lookup stays out of a plain Node run.
vi.mock("@/server/auth/platform-dal", () => ({ getPlatformGrant: mocks.grant }));
vi.mock("@/server/platform/platform-audit", () => ({ recordPlatformAudit: mocks.audit }));
vi.mock("@/features/platform/server/platform-repository", () => ({
  findUserIdentity: mocks.identity,
  findOrganizationIdentity: mocks.org,
  setUserDisabled: mocks.setUser,
  updateOrganizationStatus: mocks.setOrg,
  deleteUserSessions: mocks.sessions,
  getOrganizationDetail: mocks.orgDetail,
  getUserDetail: mocks.userDetail,
}));

import { changeOrganizationStatus, changeUserState } from "@/features/platform/server/platform-service";
import { assertUserActive, assertWorkspaceActive } from "@/server/auth/lifecycle";

const actor = { id: "11111111-1111-4111-8111-111111111111", email: "admin@example.test" };
const target = "22222222-2222-4222-8222-222222222222";
const client = {};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((fn: (c: unknown) => unknown) => fn(client));
  // No platform grant on the target unless a test says otherwise.
  mocks.grant.mockResolvedValue(null);
  mocks.identity.mockResolvedValue({ email: "member@example.test", name: "Member", disabledAt: null });
  mocks.org.mockResolvedValue({ name: "Customer", slug: "customer", status: "active" });
  mocks.sessions.mockResolvedValue(2);
  mocks.orgDetail.mockResolvedValue({ id: target });
  mocks.userDetail.mockResolvedValue({ id: target });
});

describe("platform lifecycle mutations", () => {
  it("disables and revokes sessions inside the audit transaction", async () => {
    await changeUserState(actor, target, { disabled: true, reason: "Abuse" });

    expect(mocks.setUser).toHaveBeenCalledWith(target, true, "Abuse", client);
    expect(mocks.sessions).toHaveBeenCalledWith(target, client);
    // Same client for the write and the record: one rolls back with the other.
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.disabled",
        actorId: actor.id,
        metadata: expect.objectContaining({ revokedCount: 2 }),
      }),
      client,
    );
  });

  it("prevents self-disable and disabling platform peers", async () => {
    await expect(changeUserState(actor, actor.id, { disabled: true, reason: "Abuse" })).rejects.toThrow("own account");

    // A live grant on the target makes it a peer, not an ordinary account.
    mocks.grant.mockResolvedValue({ userId: target, grantedAt: new Date().toISOString(), note: null });
    await expect(changeUserState(actor, target, { disabled: true, reason: "Abuse" })).rejects.toThrow("platform grant");

    expect(mocks.setUser).not.toHaveBeenCalled();
  });

  it("validates the reason and the target before opening a transaction", async () => {
    // A blank reason is not a reason.
    await expect(changeOrganizationStatus(actor, target, { status: "suspended", reason: " " })).rejects.toThrow();
    await expect(changeUserState(actor, "not-a-uuid", { disabled: false })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("restores access without restoring old sessions or a stale reason", async () => {
    mocks.identity.mockResolvedValue({ email: "member@example.test", name: "Member", disabledAt: new Date() });

    await changeUserState(actor, target, { disabled: false });

    expect(mocks.setUser).toHaveBeenCalledWith(target, false, null, client);
    expect(mocks.sessions).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "user.enabled" }), client);
  });

  it("does not report a successful mutation when the audit insert fails", async () => {
    mocks.audit.mockRejectedValue(new Error("audit unavailable"));
    // withTransaction propagates, so the status change rolls back with it.
    mocks.transaction.mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => fn(client));

    await expect(changeOrganizationStatus(actor, target, { status: "suspended", reason: "Abuse" })).rejects.toThrow(
      "audit unavailable",
    );
  });

  it("audits the previous and the next organization status", async () => {
    await changeOrganizationStatus(actor, target, { status: "suspended", reason: "Investigation" });

    expect(mocks.setOrg).toHaveBeenCalledWith(target, "suspended", "Investigation", client);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { before: "active", after: "suspended", reason: "Investigation" },
      }),
      client,
    );
  });

  it("refuses an unchanged status instead of auditing a change that did not happen", async () => {
    await expect(changeOrganizationStatus(actor, target, { status: "active" })).rejects.toThrow("already active");
    expect(mocks.setOrg).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("runtime lifecycle guards", () => {
  it.each(["suspended", "disabled", "unknown"])("refuses a %s tenant on a public channel", async (status) => {
    mocks.db.mockResolvedValue([{ status }]);
    // "unknown" matters: a status added by a later migration must be closed by
    // default rather than falling through because it did not match 'suspended'.
    await expect(assertWorkspaceActive(target)).rejects.toThrow("unavailable");
  });

  it("fails closed on a missing tenant and on a disabled account", async () => {
    // No row at all - the guard must refuse rather than read undefined as ok.
    mocks.db.mockResolvedValue([]);
    await expect(assertWorkspaceActive(target)).rejects.toThrow();
    await expect(assertUserActive(target)).rejects.toThrow();

    mocks.db.mockResolvedValue([{ disabledAt: new Date() }]);
    await expect(assertUserActive(target)).rejects.toThrow();
  });

  it("allows active tenants and accounts", async () => {
    mocks.db.mockResolvedValue([{ status: "active" }]);
    await expect(assertWorkspaceActive(target)).resolves.toBeUndefined();

    mocks.db.mockResolvedValue([{ disabledAt: null }]);
    await expect(assertUserActive(target)).resolves.toBeUndefined();
  });
});
