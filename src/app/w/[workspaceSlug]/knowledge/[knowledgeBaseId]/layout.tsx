import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { KnowledgeBaseHeader } from "@/features/knowledge/components/knowledge-base-header";
import { KnowledgeBaseTabs } from "@/features/knowledge/components/knowledge-base-tabs";
import { knowledgeKeys } from "@/features/knowledge/queries";
import { findKnowledgeBaseById } from "@/features/knowledge/server/knowledge-repository";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export default async function KnowledgeBaseLayout({
  children,
  params,
}: LayoutProps<"/w/[workspaceSlug]/knowledge/[knowledgeBaseId]">) {
  const { workspaceSlug, knowledgeBaseId } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const knowledgeBase = await findKnowledgeBaseById(membership.workspace.id, knowledgeBaseId);
  if (!knowledgeBase) notFound();

  const queryClient = makeQueryClient();
  queryClient.setQueryData(knowledgeKeys.detail(workspaceSlug, knowledgeBaseId), knowledgeBase);

  return (
    <HydrateClient queryClient={queryClient}>
      <PageContainer>
        <KnowledgeBaseHeader knowledgeBaseId={knowledgeBaseId} />
        <KnowledgeBaseTabs knowledgeBaseId={knowledgeBaseId} />
        <div>{children}</div>
      </PageContainer>
    </HydrateClient>
  );
}
