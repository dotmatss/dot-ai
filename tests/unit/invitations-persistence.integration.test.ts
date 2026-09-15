// @vitest-environment node
/**
 * The invitation lifecycle against a real PostgreSQL.
 *
 * What is tested here is what TypeScript cannot see: that only a hash of the
 * token reaches the database, that the partial unique index actually stops a
 * second live invitation to one address, that acceptance is single-use, and
 * that a link issued to one address cannot add a different account. Those four
 * are the whole security story of this feature.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/dot_dev" pnpm exec vitest run invitations-persistence
 *
 * Skipped when DATABASE_URL is absent, so the default suite stays hermetic.
 */
import { createHash } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { acceptInvitation, claimInvitation, previewInvitation } from "@/features/settings/server/invitation-service";
import type { SettingsActor } from "@/features/settings/server/settings-service";
import { getMembersOverview, inviteMember, revokeInvitation } from "@/features/settings/server/settings-service";
import { isApiError } from "@/lib/api/api-error";
import { withTransaction } from "@/server/db/client";

const connectionString = process.env.DATABASE_URL;
const suffix = Math.random().toString(36).slice(2, 10);

let admin: pg.Client;
const ids = { ownerId: "", adminId: "", outsiderId: "", organizationId: "", workspaceId: "" };
const invitedEmail = `invited-${suffix}@example.com`;
const outsiderEmail = `outsider-${suffix}@example.com`;

/**
 * The actor a route handler would build from a verified workspace context.
 *
 * The `role` here is only what the request context believed; the service
 * re-reads the membership row inside its transaction and decides from that, so
 * these tests hand it a real user whose real role is the one being exercised.
 */
function actorFor(userId = ids.ownerId, role: SettingsActor["role"] = "owner"): SettingsActor {
  return {
    workspaceId: ids.workspaceId,
    organization: { id: ids.organizationId, name: `Invites ${suffix}`, slug: `invites-${suffix}` },
    userId,
    actorName: "Invite Owner",
    role,
    sessionId: "00000000-0000-0000-0000-000000000000",
  };
}

function tokenOf(inviteUrl: string): string {
  return inviteUrl.slice(inviteUrl.lastIndexOf("/") + 1);
}

async function createUser(email: string, name: string): Promise<string> {
  const row = await admin.query<{ id: string }>(
    "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, 'x') RETURNING id",
    [email, name],
  );
  return row.rows[0]!.id;
}

describe.skipIf(!connectionString)("organization invitations", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString });
    await admin.connect();

    ids.ownerId = await createUser(`owner-${suffix}@example.com`, "Invite Owner");
    ids.adminId = await createUser(`admin-${suffix}@example.com`, "Invite Admin");
    ids.outsiderId = await createUser(outsiderEmail, "Outsider");

    const org = await admin.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
      [`Invites ${suffix}`, `invites-${suffix}`],
    );
    ids.organizationId = org.rows[0]!.id;
    await admin.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [
      ids.organizationId,
      ids.ownerId,
    ]);
    await admin.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'admin')", [
      ids.organizationId,
      ids.adminId,
    ]);
    const workspace = await admin.query<{ id: string }>(
      "INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
      [ids.organizationId, `Invites WS ${suffix}`, `invites-ws-${suffix}`],
    );
    ids.workspaceId = workspace.rows[0]!.id;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.query("DELETE FROM organizations WHERE slug = $1", [`invites-${suffix}`]).catch(() => undefined);
    await admin.query("DELETE FROM users WHERE email LIKE $1", [`%${suffix}@example.com`]).catch(() => undefined);
    await admin.end().catch(() => undefined);
  });

  it("stores only the hash of the token it hands out", async () => {
    const { inviteUrl, invitation } = await inviteMember(actorFor(), { email: invitedEmail, role: "member" });
    const token = tokenOf(inviteUrl);

    const rows = await admin.query<{ token_hash: string }>(
      "SELECT token_hash FROM organization_invitations WHERE id = $1",
      [invitation.id],
    );
    expect(rows.rows[0]!.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    // The token itself appears nowhere in the row.
    const raw = await admin.query("SELECT * FROM organization_invitations WHERE id = $1", [invitation.id]);
    expect(JSON.stringify(raw.rows[0])).not.toContain(token);

    // ...and the list the client sees carries neither.
    const overview = await getMembersOverview(actorFor());
    const listed = overview.invitations.find((entry) => entry.id === invitation.id);
    expect(listed).toBeDefined();
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(listed!.status).toBe("pending");
  });

  it("refuses a second live invitation to the same address", async () => {
    await expect(inviteMember(actorFor(), { email: invitedEmail, role: "viewer" })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.status === 409,
    );
  });

  it("refuses to invite someone who is already a member", async () => {
    await expect(
      inviteMember(actorFor(), { email: `owner-${suffix}@example.com`, role: "member" }),
    ).rejects.toSatisfy((error: unknown) => isApiError(error) && error.status === 409);
  });

  it("refuses an admin trying to invite an owner", async () => {
    await expect(
      inviteMember(actorFor(ids.adminId, "admin"), { email: `never-${suffix}@example.com`, role: "owner" }),
    ).rejects.toSatisfy((error: unknown) => isApiError(error) && error.status === 403);
  });

  // The claimed role in the request context is not the decision; the row is.
  it("ignores a role the caller claims to have", async () => {
    await expect(
      inviteMember(actorFor(ids.adminId, "owner"), { email: `never-${suffix}@example.com`, role: "owner" }),
    ).rejects.toSatisfy((error: unknown) => isApiError(error) && error.status === 403);
  });

  it("lets an admin invite below owner", async () => {
    const email = `by-admin-${suffix}@example.com`;
    const { invitation } = await inviteMember(actorFor(ids.adminId, "admin"), { email, role: "member" });
    expect(invitation.email).toBe(email);
    expect(invitation.invitedByName).toBe("Invite Admin");
  });

  it("will not let a link issued to one address add a different account", async () => {
    const overview = await getMembersOverview(actorFor());
    const pending = overview.invitations.find((entry) => entry.email === invitedEmail);
    expect(pending).toBeDefined();

    // Re-issue so this test owns a token it can spend.
    await revokeInvitation(actorFor(), pending!.id);
    const { inviteUrl } = await inviteMember(actorFor(), { email: invitedEmail, role: "member" });

    await expect(
      acceptInvitation(tokenOf(inviteUrl), { id: ids.outsiderId, email: outsiderEmail, name: "Outsider" }),
    ).rejects.toSatisfy((error: unknown) => isApiError(error) && error.status === 403);

    const members = await admin.query("SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2", [
      ids.organizationId,
      ids.outsiderId,
    ]);
    expect(members.rowCount).toBe(0);
  });

  it("creates the membership once, and only once", async () => {
    const invitedId = await createUser(invitedEmail, "Invited Person");

    const overview = await getMembersOverview(actorFor());
    const pending = overview.invitations.find((entry) => entry.email === invitedEmail)!;
    expect(pending).toBeDefined();

    // The live token from the previous test was not spent; re-issue to be sure
    // this test does not depend on the order the others ran in.
    await revokeInvitation(actorFor(), pending.id);
    const { inviteUrl } = await inviteMember(actorFor(), { email: invitedEmail, role: "admin" });
    const token = tokenOf(inviteUrl);

    const accepted = await acceptInvitation(token, { id: invitedId, email: invitedEmail, name: "Invited Person" });
    expect(accepted.workspaceSlug).toBe(`invites-ws-${suffix}`);

    const role = await admin.query<{ role: string }>(
      "SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2",
      [ids.organizationId, invitedId],
    );
    expect(role.rows[0]!.role).toBe("admin");

    // Second use of the same link fails: the row is no longer open.
    await expect(
      acceptInvitation(token, { id: invitedId, email: invitedEmail, name: "Invited Person" }),
    ).rejects.toSatisfy((error: unknown) => isApiError(error) && error.status === 404);

    // And it has left the pending list.
    const after = await getMembersOverview(actorFor());
    expect(after.invitations.some((entry) => entry.email === invitedEmail)).toBe(false);
    expect(after.members.some((member) => member.email === invitedEmail)).toBe(true);
  });

  it("stops accepting once the invitation has expired", async () => {
    const email = `late-${suffix}@example.com`;
    const lateId = await createUser(email, "Late Person");
    const { inviteUrl, invitation } = await inviteMember(actorFor(), { email, role: "member" });

    await admin.query("UPDATE organization_invitations SET expires_at = now() - interval '1 day' WHERE id = $1", [
      invitation.id,
    ]);

    // The preview still resolves - the page needs the name to explain itself -
    // but the claim refuses.
    const preview = await previewInvitation(tokenOf(inviteUrl));
    expect(preview?.organizationName).toBe(`Invites ${suffix}`);

    await expect(
      withTransaction((client) => claimInvitation(client, tokenOf(inviteUrl), { id: lateId, email })),
    ).rejects.toSatisfy((error: unknown) => isApiError(error) && error.status === 400);

    const listed = await getMembersOverview(actorFor());
    expect(listed.invitations.find((entry) => entry.email === email)?.status).toBe("expired");
  });

  it("makes a revoked link unusable and hides it from the list", async () => {
    const email = `revoked-${suffix}@example.com`;
    const revokedId = await createUser(email, "Revoked Person");
    const { inviteUrl, invitation } = await inviteMember(actorFor(), { email, role: "member" });

    await revokeInvitation(actorFor(), invitation.id);

    expect(await previewInvitation(tokenOf(inviteUrl))).toBeNull();
    await expect(
      acceptInvitation(tokenOf(inviteUrl), { id: revokedId, email, name: "Revoked Person" }),
    ).rejects.toSatisfy((error: unknown) => isApiError(error) && error.status === 404);

    const overview = await getMembersOverview(actorFor());
    expect(overview.invitations.some((entry) => entry.email === email)).toBe(false);
  });
});
