"use client";

import { KeyRound } from "lucide-react";

import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppCard } from "@/components/ui/app-card";
import { useAuthorizeMcpServerMutation, useRevokeMcpOauthMutation } from "@/features/mcp/mutations";
import type { McpServerSummary } from "@/features/mcp/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";

/**
 * The OAuth state of one server.
 *
 * Shown only for a server configured to use OAuth. The distinction it has to
 * make clear is between *configured* and *authorized*: an OAuth server that
 * nobody has signed in at holds no token, so its calls will fail with a 401
 * however carefully its tools were approved.
 *
 * There is no field here for a token, and there never should be. The token
 * arrives through the flow, is sealed with a workspace-bound key, and is never
 * sent to a browser.
 */
export function McpOauthPanel({ server }: { server: McpServerSummary }) {
  const { membership } = useWorkspace();
  const manageable = canManage(membership.role);
  const authorize = useAuthorizeMcpServerMutation(server.id);
  const revoke = useRevokeMcpOauthMutation(server.id);

  if (server.authKind !== "oauth") return null;

  const authorized = server.hasOauthToken;
  const needsScope = server.oauthNeedsScope;

  return (
    <AppCard padding="md" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <KeyRound aria-hidden className="size-4" />
            OAuth authorization
            <AppBadge tone={authorized ? "success" : "warning"}>{authorized ? "Authorized" : "Not authorized"}</AppBadge>
          </h3>
          <p className="mt-1 text-sm text-foreground-muted">
            {authorized
              ? "This workspace holds an access token for the server. It is refreshed automatically and can be removed here."
              : "Nobody has authorized this server yet. Its tools cannot be called until somebody signs in at the server and consents."}
          </p>
        </div>

        {manageable ? (
          <div className="flex shrink-0 gap-2">
            {authorized ? (
              <AppButton variant="secondary" onClick={() => revoke.mutate()} loading={revoke.isPending}>
                Remove authorization
              </AppButton>
            ) : null}
            <AppButton onClick={() => authorize.mutate()} loading={authorize.isPending}>
              {authorized ? "Re-authorize" : "Authorize"}
            </AppButton>
          </div>
        ) : (
          <AppBadge tone="neutral">Admins authorize</AppBadge>
        )}
      </div>

      {needsScope ? (
        <AppAlert tone="warning" title="The server asked for more access">
          A call was refused because our token does not carry the scope <code>{needsScope}</code>. Re-authorize to ask for
          it; the server decides whether to grant it.
        </AppAlert>
      ) : null}

      <p className="text-xs text-foreground-subtle">
        We authenticate as a public client with no shared secret, using PKCE and a published client metadata document.
        Access is the server&apos;s to grant and to revoke.
      </p>
    </AppCard>
  );
}
