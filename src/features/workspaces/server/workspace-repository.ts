import "server-only";

import { and, asc, eq } from "drizzle-orm";
import type { PoolClient } from "pg";

import type { OrganizationStatus } from "@/features/platform/types";
import type { MemberRole } from "@/features/workspaces/roles";
import type { OrganizationSummary, WorkspaceMembership, WorkspaceSummary } from "@/features/workspaces/types";
import { ApiError } from "@/lib/api/api-error";
import { slugify, withSuffix } from "@/lib/slug";
import { withDb, type DatabaseClient } from "@/server/db/client";
import { organizationMembers, organizations, workspaces } from "@/server/db/schema";
import { toIsoRequired } from "@/server/db/sql";

function mapMembership(row: {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  workspaceCreatedAt: Date;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationStatus: OrganizationStatus;
  role: MemberRole;
}): WorkspaceMembership {
  return {
    workspace: {
      id: row.workspaceId,
      organizationId: row.organizationId,
      name: row.workspaceName,
      slug: row.workspaceSlug,
      createdAt: toIsoRequired(row.workspaceCreatedAt),
    },
    organization: { id: row.organizationId, name: row.organizationName, slug: row.organizationSlug },
    role: row.role,
    organizationStatus: row.organizationStatus,
  };
}

export async function listUserWorkspaces(userId: string): Promise<WorkspaceMembership[]> {
  const rows = await withDb((db) =>
    db
      .select({
        workspaceId: workspaces.id,
        workspaceName: workspaces.name,
        workspaceSlug: workspaces.slug,
        workspaceCreatedAt: workspaces.createdAt,
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
        organizationStatus: organizations.status,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .innerJoin(workspaces, eq(workspaces.organizationId, organizations.id))
      .where(eq(organizationMembers.userId, userId))
      .orderBy(asc(organizations.name), asc(workspaces.name)),
  );
  return rows.map(mapMembership);
}

export async function listUserOrganizations(userId: string): Promise<Array<OrganizationSummary & { role: MemberRole }>> {
  return withDb((db) =>
    db
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(eq(organizationMembers.userId, userId), eq(organizations.status, "active")))
      .orderBy(asc(organizations.name)),
  );
}

async function uniqueSlug(table: "organizations" | "workspaces", base: string, client: DatabaseClient): Promise<string> {
  const root = slugify(base);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = withSuffix(root, attempt);
    const rows = await withDb(
      (db) =>
        table === "organizations"
          ? db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, candidate)).limit(1)
          : db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, candidate)).limit(1),
      client,
    );
    if (rows.length === 0) return candidate;
  }
  throw ApiError.conflict("Could not allocate a unique slug");
}

export async function insertOrganization(client: PoolClient, input: { name: string; ownerId: string }): Promise<OrganizationSummary> {
  const slug = await uniqueSlug("organizations", input.name, client);
  const rows = await withDb(
    (db) => db.insert(organizations).values({ name: input.name, slug }).returning({ id: organizations.id, name: organizations.name, slug: organizations.slug }),
    client,
  );
  const org = rows[0];
  if (!org) throw new Error("Failed to create organization");
  await withDb(
    (db) => db.insert(organizationMembers).values({ organizationId: org.id, userId: input.ownerId, role: "owner" }),
    client,
  );
  return org;
}

export async function insertWorkspace(input: { organizationId: string; name: string }, client: DatabaseClient): Promise<WorkspaceSummary> {
  const slug = await uniqueSlug("workspaces", input.name, client);
  const rows = await withDb(
    (db) =>
      db
        .insert(workspaces)
        .values({ organizationId: input.organizationId, name: input.name, slug })
        .returning({ id: workspaces.id, organizationId: workspaces.organizationId, name: workspaces.name, slug: workspaces.slug, createdAt: workspaces.createdAt }),
    client,
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create workspace");
  return { ...row, createdAt: toIsoRequired(row.createdAt) };
}

export async function updateWorkspaceName(workspaceId: string, name: string): Promise<WorkspaceSummary | null> {
  const rows = await withDb((db) =>
    db
      .update(workspaces)
      .set({ name })
      .where(eq(workspaces.id, workspaceId))
      .returning({ id: workspaces.id, organizationId: workspaces.organizationId, name: workspaces.name, slug: workspaces.slug, createdAt: workspaces.createdAt }),
  );
  const row = rows[0];
  return row ? { ...row, createdAt: toIsoRequired(row.createdAt) } : null;
}

export async function findMemberRole(organizationId: string, userId: string): Promise<MemberRole | null> {
  const rows = await withDb((db) =>
    db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId), eq(organizations.status, "active")))
      .limit(1),
  );
  return rows[0]?.role ?? null;
}

export async function findWorkspaceSlugById(workspaceId: string): Promise<string | null> {
  const rows = await withDb((db) => db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1));
  return rows[0]?.slug ?? null;
}

export async function findOrganizationDefaultWorkspace(organizationId: string, client?: DatabaseClient): Promise<{ id: string; slug: string } | null> {
  const rows = await withDb(
    (db) => db.select({ id: workspaces.id, slug: workspaces.slug }).from(workspaces).where(eq(workspaces.organizationId, organizationId)).orderBy(asc(workspaces.createdAt)).limit(1),
    client,
  );
  return rows[0] ?? null;
}
