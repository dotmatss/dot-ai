import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { CollectionHeader } from "@/features/knowledge/components/collection-header";
import { CollectionTabs } from "@/features/knowledge/components/collection-tabs";
import { knowledgeKeys } from "@/features/knowledge/queries";
import { findCollectionById } from "@/features/knowledge/server/knowledge-repository";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export default async function CollectionLayout({
  children,
  params,
}: LayoutProps<"/w/[workspaceSlug]/knowledge/collections/[collectionId]">) {
  const { workspaceSlug, collectionId } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const collection = await findCollectionById(membership.workspace.id, collectionId);
  if (!collection) notFound();

  const queryClient = makeQueryClient();
  queryClient.setQueryData(knowledgeKeys.collection(workspaceSlug, collectionId), collection);

  return (
    <HydrateClient queryClient={queryClient}>
      <PageContainer>
        <CollectionHeader collectionId={collectionId} />
        <CollectionTabs collectionId={collectionId} />
        <div>{children}</div>
      </PageContainer>
    </HydrateClient>
  );
}
