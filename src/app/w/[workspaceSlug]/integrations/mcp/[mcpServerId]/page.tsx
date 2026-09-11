import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppHeading, AppText } from "@/components/ui/app-typography";
import { MCP_SERVER_STATUS_META } from "@/features/mcp/constants";
import { McpOauthPanel } from "@/features/mcp/components/mcp-oauth-panel";
import { McpServerActions } from "@/features/mcp/components/mcp-server-actions";
import { McpToolApprovals } from "@/features/mcp/components/mcp-tool-approvals";
import { mcpKeys } from "@/features/mcp/queries";
import { getMcpServer, listMcpTools } from "@/features/mcp/server/mcp-service";
import { isApiError } from "@/lib/api/api-error";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "MCP server" };

/**
 * One MCP server: its state, and which of its tools are approved.
 *
 * The endpoint URL is shown to an admin because they configured it, but it is
 * never logged or echoed in an error: an MCP endpoint can carry a token in its
 * path, which is why probe messages name only the host and the condition.
 */
export default async function McpServerPage({ params }: PageProps<"/w/[workspaceSlug]/integrations/mcp/[mcpServerId]">) {
  const { workspaceSlug, mcpServerId } = await params;
  const { membership, user } = await requireWorkspaceAccess(workspaceSlug);
  const ctx = { workspaceId: membership.workspace.id, userId: user.id };

  const server = await getMcpServer(ctx, mcpServerId).catch((error) => {
    // A server in another workspace is indistinguishable from one that does
    // not exist, both here and in the API.
    if (isApiError(error) && error.status === 404) notFound();
    throw error;
  });

  const queryClient = makeQueryClient();
  queryClient.setQueryData(mcpKeys.server(workspaceSlug, mcpServerId), server);
  queryClient.setQueryData(mcpKeys.tools(workspaceSlug, mcpServerId), await listMcpTools(ctx, mcpServerId));

  const status = MCP_SERVER_STATUS_META[server.status];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Link
          href={`/w/${workspaceSlug}/integrations/mcp` as Route}
          className="w-fit rounded-xs text-xs text-foreground-muted hover:text-foreground focus-ring"
        >
          &larr; All MCP servers
        </Link>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <AppHeading level={2} className="text-lg">
                {server.name}
              </AppHeading>
              <AppBadge tone={status.tone} size="sm" dot>
                {status.label}
              </AppBadge>
            </div>
            <AppText size="sm" tone="muted">
              {status.description}
            </AppText>
            <p className="mt-1.5 break-all font-mono text-caption text-foreground-subtle">
              {server.endpointUrl} · Streamable HTTP · tools appear to agents as{" "}
              <span className="text-foreground-muted">mcp.{server.slug}.&hellip;</span>
            </p>
          </div>
          <HydrateClient queryClient={queryClient}>
            <McpServerActions serverId={mcpServerId} />
          </HydrateClient>
        </div>

        {server.lastProbeMessage ? (
          <AppAlert tone={server.lastProbeOk ? "success" : "warning"} title="Last check">
            {server.lastProbeMessage}
          </AppAlert>
        ) : null}
      </div>

      {server.authKind === "oauth" ? (
        <HydrateClient queryClient={queryClient}>
          <McpOauthPanel server={server} />
        </HydrateClient>
      ) : null}

      <section aria-labelledby="mcp-tools">
        <AppHeading level={3} id="mcp-tools" className="text-base">
          Tools
        </AppHeading>
        <div className="mt-4">
          <HydrateClient queryClient={queryClient}>
            <McpToolApprovals serverId={mcpServerId} />
          </HydrateClient>
        </div>
      </section>
    </div>
  );
}
