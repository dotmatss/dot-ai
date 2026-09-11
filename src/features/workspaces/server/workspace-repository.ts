import "server-only";

import type { PoolClient } from "pg";

import type { MemberRole } from "@/features/workspaces/roles";
import type { OrganizationSummary, WorkspaceMembership, WorkspaceSummary } from "@/features/workspaces/types";
import { ApiError } from "@/lib/api/api-error";
import { slugify, withSuffix } from "@/lib/slug";
import { query, queryOne, type Queryable } from "@/server/db/client";
import { toIsoRequired } from "@/server/db/sql";

interface MembershipRow {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  workspace_created_at: Date;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  role: MemberRole;
}

function mapMembership(row: MembershipRow): WorkspaceMembership {
  return {
    workspace: {
      id: row.workspace_id,
      organizationId: row.organization_id,
      name: row.workspace_name,
      slug: row.workspace_slug,
      createdAt: toIsoRequired(row.workspace_created_at),
    },
    organization: { id: row.organization_id, name: row.organization_name, slug: row.organization_slug },
    role: row.role,
  };
}

export async function listUserWorkspaces(userId: string): Promise<WorkspaceMembership[]> {
  const rows = await query<MembershipRow>(
    `SELECT w.id AS workspace_id, w.name AS workspace_name, w.slug AS workspace_slug, w.created_at AS workspace_created_at,
            o.id AS organization_id, o.name AS organization_name, o.slug AS organization_slug, m.role
     FROM organization_members m
     JOIN organizations o ON o.id = m.organization_id
     JOIN workspaces w ON w.organization_id = o.id
     WHERE m.user_id = $1
     ORDER BY o.name, w.name`,
    [userId],
  );
  return rows.map(mapMembership);
}

export async function listUserOrganizations(userId: string): Promise<Array<OrganizationSummary & { role: MemberRole }>> {
  const rows = await query<{ id: string; name: string; slug: string; role: MemberRole }>(
    `SELECT o.id, o.name, o.slug, m.role
     FROM organization_members m JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = $1 ORDER BY o.name`,
    [userId],
  );
  return rows;
}

async function uniqueSlug(table: "organizations" | "workspaces", base: string, client: Queryable): Promise<string> {
  const root = slugify(base);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = withSuffix(root, attempt);
    const existing = await queryOne<{ id: string }>(`SELECT id FROM ${table} WHERE slug = $1`, [candidate], client);
    if (!existing) return candidate;
  }
  throw ApiError.conflict("Could not allocate a unique slug");
}

export async function insertOrganization(client: PoolClient, input: { name: string; ownerId: string }): Promise<OrganizationSummary> {
  const slug = await uniqueSlug("organizations", input.name, client);
  const org = await queryOne<{ id: string; name: string; slug: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug",
    [input.name, slug],
    client,
  );
  if (!org) throw new Error("Failed to create organization");
  await query(
    "INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
    [org.id, input.ownerId],
    client,
  );
  return org;
}

export async function insertWorkspace(input: { organizationId: string; name: string }, client: Queryable): Promise<WorkspaceSummary> {
  const slug = await uniqueSlug("workspaces", input.name, client);
  const row = await queryOne<{ id: string; organization_id: string; name: string; slug: string; created_at: Date }>(
    `INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3)
     RETURNING id, organization_id, name, slug, created_at`,
    [input.organizationId, input.name, slug],
    client,
  );
  if (!row) throw new Error("Failed to create workspace");
  return { id: row.id, organizationId: row.organization_id, name: row.name, slug: row.slug, createdAt: toIsoRequired(row.created_at) };
}

export async function updateWorkspaceName(workspaceId: string, name: string): Promise<WorkspaceSummary | null> {
  const row = await queryOne<{ id: string; organization_id: string; name: string; slug: string; created_at: Date }>(
    `UPDATE workspaces SET name = $2 WHERE id = $1 RETURNING id, organization_id, name, slug, created_at`,
    [workspaceId, name],
  );
  return row
    ? { id: row.id, organizationId: row.organization_id, name: row.name, slug: row.slug, createdAt: toIsoRequired(row.created_at) }
    : null;
}

export async function findMemberRole(organizationId: string, userId: string): Promise<MemberRole | null> {
  const row = await queryOne<{ role: MemberRole }>(
    "SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2",
    [organizationId, userId],
  );
  return row?.role ?? null;
}
