import { Bot, Globe } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButtonLink } from "@/components/ui/app-button";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableRow,
} from "@/components/ui/app-table";
import { ChatbotStatusBadge } from "@/features/chatbots/components/chatbot-status-badge";
import type { EmbedDeployment } from "@/features/chatbots/server/embed-deployments";

interface EmbedDeploymentsPanelProps {
  deployments: EmbedDeployment[];
  workspaceSlug: string;
}

/**
 * Which chatbots are reachable from a website, and from where.
 *
 * A Server Component: every cell is a read. The controls that change a
 * deployment stay on the chatbot's own Deploy tab rather than being duplicated
 * here, so the embed rules have exactly one place to live.
 *
 * The embed key is shown deliberately - it is the public identifier already
 * present in the snippet on the customer's page, not a credential.
 */
export function EmbedDeploymentsPanel({ deployments, workspaceSlug }: EmbedDeploymentsPanelProps) {
  if (deployments.length === 0) {
    return (
      <AppTableContainer>
        <AppEmptyState
          icon={<Bot aria-hidden />}
          title="No chatbots to embed yet"
          description="Create a chatbot, allow the domains that may use it, then activate it. Its snippet appears on the chatbot's Deploy tab."
          action={
            <AppButtonLink href={`/w/${workspaceSlug}/chatbots` as Route} size="sm">
              Go to chatbots
            </AppButtonLink>
          }
        />
      </AppTableContainer>
    );
  }

  const unreachable = deployments.filter((deployment) => deployment.status === "active" && deployment.allowedDomains.length === 0);

  return (
    <div className="flex flex-col gap-4">
      {unreachable.length > 0 ? (
        <AppAlert tone="warning" title="Active, but no site is allowed to use it">
          {unreachable.length === 1
            ? `“${unreachable[0]!.name}” is active with no allowed domains, so the widget refuses every request. Add a domain on its Deploy tab.`
            : `${unreachable.length} active chatbots have no allowed domains, so the widget refuses every request to them.`}
        </AppAlert>
      ) : null}

      <AppTableContainer>
        <AppTable>
          <AppTableHeader>
            <AppTableRow>
              <AppTableHead>Chatbot</AppTableHead>
              <AppTableHead>Status</AppTableHead>
              <AppTableHead>Allowed domains</AppTableHead>
              <AppTableHead className="text-right">Widget conversations</AppTableHead>
              <AppTableHead>Last widget message</AppTableHead>
              <AppTableHead>
                <span className="sr-only">Actions</span>
              </AppTableHead>
            </AppTableRow>
          </AppTableHeader>
          <AppTableBody>
            {deployments.map((deployment) => (
              <AppTableRow key={deployment.chatbotId}>
                <AppTableCell>
                  <Link
                    href={`/w/${workspaceSlug}/chatbots/${deployment.chatbotId}/deploy` as Route}
                    className="rounded-sm font-medium text-foreground hover:underline hover:underline-offset-4 focus-ring"
                  >
                    {deployment.name}
                  </Link>
                  <span className="mt-0.5 block font-mono text-caption text-foreground-muted">{deployment.embedKey}</span>
                </AppTableCell>
                <AppTableCell>
                  <ChatbotStatusBadge status={deployment.status} size="sm" />
                </AppTableCell>
                <AppTableCell>
                  {deployment.allowedDomains.length === 0 ? (
                    <span className="text-xs text-foreground-muted">None</span>
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      {deployment.allowedDomains.slice(0, 3).map((domain) => (
                        <AppBadge key={domain} size="sm" icon={<Globe aria-hidden />}>
                          {domain}
                        </AppBadge>
                      ))}
                      {deployment.allowedDomains.length > 3 ? (
                        <AppBadge size="sm">{`+${deployment.allowedDomains.length - 3} more`}</AppBadge>
                      ) : null}
                    </span>
                  )}
                </AppTableCell>
                <AppTableCell className="text-right tabular-nums">{deployment.widgetConversations}</AppTableCell>
                <AppTableCell className="whitespace-nowrap text-foreground-muted">
                  {deployment.lastWidgetMessageAt ? (
                    <AppRelativeTime value={deployment.lastWidgetMessageAt} />
                  ) : (
                    <span aria-label="Never">&mdash;</span>
                  )}
                </AppTableCell>
                <AppTableCell className="text-right">
                  <AppButtonLink
                    href={`/w/${workspaceSlug}/chatbots/${deployment.chatbotId}/deploy` as Route}
                    variant="secondary"
                    size="sm"
                  >
                    Configure
                  </AppButtonLink>
                </AppTableCell>
              </AppTableRow>
            ))}
          </AppTableBody>
        </AppTable>
      </AppTableContainer>
    </div>
  );
}
