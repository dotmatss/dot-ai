import type { Metadata } from "next";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { CreateKnowledgeBaseButton } from "@/features/knowledge/components/create-knowledge-base-dialog";
import { KnowledgeBasesList } from "@/features/knowledge/components/knowledge-bases-list";
import { parseKnowledgeBaseFilters } from "@/features/knowledge/filters";
import { knowledgeKeys } from "@/features/knowledge/queries";
import { getKnowledgeBases } from "@/features/knowledge/server/knowledge-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Knowledge" };

export default async function KnowledgePage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/knowledge">) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const filters = parseKnowledgeBaseFilters(query);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    knowledgeKeys.list(workspaceSlug, filters),
    await getKnowledgeBases(membership.workspace.id, filters),
  );

  return (
    <PageContainer>
      <PageHeader
        title="Knowledge"
        description="Give your chatbots and agents something to answer from: paste text, import pages and upload files, then test what retrieval returns."
        actions={<CreateKnowledgeBaseButton />}
      />
      <HydrateClient queryClient={queryClient}>
        <KnowledgeBasesList />
      </HydrateClient>
    </PageContainer>
  );
}
