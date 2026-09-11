import type { Metadata } from "next";

import { KnowledgeSourcesPanel } from "@/features/knowledge/components/knowledge-sources-panel";
import { KNOWLEDGE_SOURCES_PAGE_SIZE } from "@/features/knowledge/constants";
import { parseKnowledgeSourceFilters } from "@/features/knowledge/filters";
import { knowledgeKeys } from "@/features/knowledge/queries";
import { getKnowledgeSources } from "@/features/knowledge/server/knowledge-service";
import { collectionScope } from "@/features/knowledge/types";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Collection sources" };

export default async function CollectionSourcesPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/knowledge/collections/[collectionId]">) {
  const [{ workspaceSlug, collectionId }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const filters = parseKnowledgeSourceFilters(query, KNOWLEDGE_SOURCES_PAGE_SIZE);
  const scope = collectionScope(collectionId);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    knowledgeKeys.sourceList(workspaceSlug, scope, filters),
    await getKnowledgeSources(membership.workspace.id, scope, filters),
  );

  return (
    <HydrateClient queryClient={queryClient}>
      <KnowledgeSourcesPanel
        scope={scope}
        description="Each source is split into overlapping passages, embedded and indexed. Retrieval ranks passages, not whole documents."
      />
    </HydrateClient>
  );
}
