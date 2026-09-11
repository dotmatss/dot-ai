import type { Metadata } from "next";

import { KnowledgeSourcesPanel } from "@/features/knowledge/components/knowledge-sources-panel";
import { parseKnowledgeSourceFilters } from "@/features/knowledge/filters";
import { KNOWLEDGE_SOURCES_PAGE_SIZE } from "@/features/knowledge/constants";
import { knowledgeKeys } from "@/features/knowledge/queries";
import { getKnowledgeSources } from "@/features/knowledge/server/knowledge-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Knowledge sources" };

export default async function KnowledgeSourcesPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/knowledge/[knowledgeBaseId]">) {
  const [{ workspaceSlug, knowledgeBaseId }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const filters = parseKnowledgeSourceFilters(query, KNOWLEDGE_SOURCES_PAGE_SIZE);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    knowledgeKeys.sourceList(workspaceSlug, knowledgeBaseId, filters),
    await getKnowledgeSources(membership.workspace.id, knowledgeBaseId, filters),
  );

  return (
    <HydrateClient queryClient={queryClient}>
      <KnowledgeSourcesPanel knowledgeBaseId={knowledgeBaseId} />
    </HydrateClient>
  );
}
