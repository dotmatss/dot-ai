import type { Metadata } from "next";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { CreateCollectionButton } from "@/features/knowledge/components/create-collection-dialog";
import { KnowledgeOverview } from "@/features/knowledge/components/knowledge-overview";
import { COLLECTIONS_OVERVIEW_LIMIT } from "@/features/knowledge/constants";
import { knowledgeKeys } from "@/features/knowledge/queries";
import { getKnowledgeOverview } from "@/features/knowledge/server/knowledge-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Knowledge" };

export default async function KnowledgePage({ params }: PageProps<"/w/[workspaceSlug]/knowledge">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    knowledgeKeys.overview(workspaceSlug),
    await getKnowledgeOverview(membership.workspace.id, COLLECTIONS_OVERVIEW_LIMIT),
  );

  return (
    <PageContainer>
      <PageHeader
        title="Knowledge"
        description="Group your sources into collections, then give an agent the collections it may answer from — and only those."
        actions={<CreateCollectionButton />}
      />
      <HydrateClient queryClient={queryClient}>
        <KnowledgeOverview />
      </HydrateClient>
    </PageContainer>
  );
}
