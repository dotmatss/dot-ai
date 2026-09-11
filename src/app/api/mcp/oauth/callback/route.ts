import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { completeMcpOauth } from "@/features/mcp/server/mcp-oauth";
import { findWorkspaceSlugById } from "@/features/workspaces/server/workspace-repository";

/**
 * Where an authorization server sends the browser back.
 *
 * Not workspace-scoped, and that is deliberate: this URL is registered in our
 * client metadata document and has to be one fixed value. The `state`
 * parameter is what identifies the flow — it is single-use, 256 bits of
 * randomness, and redeeming it deletes the row — so neither the workspace nor
 * the server is taken from the query string.
 *
 * A failure redirects with a message rather than rendering an error page: the
 * person is mid-way through connecting something and needs to land back where
 * they started.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;

  const error = params.get("error");
  const state = params.get("state");
  const code = params.get("code");

  // The authorization server refused or the person declined. There is nothing
  // to exchange, and the stored state expires on its own.
  if (error || !state || !code) {
    const reason = error === "access_denied" ? "You declined the authorization." : "The authorization did not complete.";
    redirect(`/?mcp_oauth_error=${encodeURIComponent(reason)}`);
  }

  let outcome: { workspaceId: string; serverId: string };
  try {
    outcome = await completeMcpOauth({ state, code, iss: params.get("iss") });
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : "The authorization could not be completed.";
    redirect(`/?mcp_oauth_error=${encodeURIComponent(message)}`);
  }

  const slug = await findWorkspaceSlugById(outcome.workspaceId);
  if (!slug) redirect("/");

  redirect(`/w/${slug}/integrations/mcp/${outcome.serverId}?authorized=1`);
}
