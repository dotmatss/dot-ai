"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";

import { hasMinimumRole } from "@/features/workspaces/roles";
import { createWorkspaceSchema, type CreateWorkspaceInput } from "@/features/workspaces/schemas";
import { findMemberRole, insertWorkspace } from "@/features/workspaces/server/workspace-repository";
import { isApiError } from "@/lib/api/api-error";
import { requireAuthOrRedirect } from "@/server/auth/dal";
import { DatabaseUnavailableError, getPool } from "@/server/db/client";
import { actionFailure, type ActionResult } from "@/types/action-result";

export async function createWorkspaceAction(input: CreateWorkspaceInput): Promise<ActionResult> {
  const auth = await requireAuthOrRedirect("/onboarding");
  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure("Check the highlighted fields", z.flattenError(parsed.error).fieldErrors);
  }

  let slug: string;
  try {
    const role = await findMemberRole(parsed.data.organizationId, auth.user.id);
    if (!role || !hasMinimumRole(role, "admin")) {
      return actionFailure("You need to be an organization admin to create workspaces");
    }
    const workspace = await insertWorkspace({ organizationId: parsed.data.organizationId, name: parsed.data.name }, getPool());
    slug = workspace.slug;
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return actionFailure("The database is unavailable.");
    if (isApiError(error)) return actionFailure(error.message);
    console.error("[workspaces] create failed", error);
    return actionFailure("Could not create the workspace. Please try again.");
  }
  redirect(`/w/${slug}/dashboard` as Route);
}
