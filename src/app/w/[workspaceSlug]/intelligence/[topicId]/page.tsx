import type { Metadata } from "next";

import { TopicDetail } from "@/features/intelligence/components/topic-detail";
import { intelligenceKeys } from "@/features/intelligence/queries";
import { getTopic } from "@/features/intelligence/server/intelligence-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Topic" };

export default async function TopicPage({ params }: PageProps<"/w/[workspaceSlug]/intelligence/[topicId]">) {
  const { workspaceSlug, topicId } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);

  // Throws a 404 through the service if the topic is not this workspace's,
  // before anything reaches the client.
  const topic = await getTopic(membership.workspace.id, topicId);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(intelligenceKeys.detail(workspaceSlug, topicId), topic);

  return (
    <HydrateClient queryClient={queryClient}>
      <TopicDetail topicId={topicId} />
    </HydrateClient>
  );
}
