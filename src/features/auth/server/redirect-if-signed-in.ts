import "server-only";

import type { Route } from "next";
import { redirect } from "next/navigation";

import { findDefaultWorkspaceSlug } from "@/features/auth/server/auth-service";
import { getAuthContext } from "@/server/auth/dal";

/**
 * Sends an already-authenticated visitor away from the auth pages.
 *
 * This lives on the page rather than in `proxy.ts` on purpose: only a verified
 * session may cause the redirect. A cookie can outlive its session row, and
 * bouncing on cookie presence alone traps such a browser in a redirect loop it
 * cannot escape, because the cookie is HttpOnly.
 */
export async function redirectIfSignedIn(): Promise<void> {
  const auth = await getAuthContext();
  if (!auth) return;
  const slug = await findDefaultWorkspaceSlug(auth.user.id);
  redirect((slug ? `/w/${slug}/dashboard` : "/onboarding") as Route);
}
