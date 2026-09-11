import type { Metadata } from "next";
import type { Route } from "next";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { CollectionsList } from "@/features/knowledge/components/collections-list";
import { CreateCollectionButton } from "@/features/knowledge/components/create-collection-dialog";
import { parseCollectionFilters } from "@/features/knowledge/filters";
import { knowledgeKeys } from "@/features/knowledge/queries";
import { getCollections } from "@/features/knowledge/server/knowledge-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Collections" };

export default async function CollectionsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/knowledge/collections">) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const filters = parseCollectionFilters(query);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    knowledgeKeys.collectionList(workspaceSlug, filters),
    await getCollections(membership.workspace.id, filters),
  );

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Knowledge", href: `/w/${workspaceSlug}/knowledge` as Route }, { label: "Collections" }]}
        title="Collections"
        description="A collection is a logical grouping of sources. It decides what an agent can retrieve, not how retrieval works."
        actions={<CreateCollectionButton />}
      />
      <HydrateClient queryClient={queryClient}>
        <CollectionsList />
      </HydrateClient>
    </PageContainer>
  );
}
