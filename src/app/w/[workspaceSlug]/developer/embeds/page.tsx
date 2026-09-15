import type { Metadata, Route } from "next";
import Link from "next/link";

import { AppHeading, AppText } from "@/components/ui/app-typography";
import { listEmbedDeployments } from "@/features/chatbots/server/embed-deployments";
import { EmbedDeploymentsPanel } from "@/features/developer/components/embed-deployments-panel";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Embeds" };

export default async function EmbedsPage({ params }: PageProps<"/w/[workspaceSlug]/developer/embeds">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const deployments = await listEmbedDeployments(membership.workspace.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <AppHeading level={2} className="text-lg">
          Embeds
        </AppHeading>
        <AppText size="sm" tone="muted">
          Every chatbot that can be placed on a website. The widget answers only for chatbots that are active, and only
          for the domains listed here. Calling from your own server instead? Use an{" "}
          <Link
            href={`/w/${workspaceSlug}/developer` as Route}
            className="rounded-sm text-foreground underline underline-offset-4 focus-ring"
          >
            API key
          </Link>
          .
        </AppText>
      </div>
      <EmbedDeploymentsPanel deployments={deployments} workspaceSlug={workspaceSlug} />
    </div>
  );
}
