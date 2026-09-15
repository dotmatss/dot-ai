import type { Metadata } from "next";

import { RolesMatrix } from "@/features/settings/components/roles-matrix";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Roles and permissions" };

/**
 * Viewer-floored on purpose: knowing what your own role permits is not itself a
 * privilege, and a member who cannot see why a button is disabled will ask an
 * admin instead of reading the answer.
 */
export default async function SettingsRolesPage({ params }: PageProps<"/w/[workspaceSlug]/settings/roles">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspaceAccess(workspaceSlug);

  return <RolesMatrix currentRole={ctx.membership.role} />;
}
