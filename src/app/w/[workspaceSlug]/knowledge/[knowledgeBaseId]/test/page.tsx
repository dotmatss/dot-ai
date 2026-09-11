import type { Metadata } from "next";

import { KnowledgeTestPanel } from "@/features/knowledge/components/knowledge-test-panel";

export const metadata: Metadata = { title: "Test retrieval" };

export default async function KnowledgeTestPage({
  params,
}: PageProps<"/w/[workspaceSlug]/knowledge/[knowledgeBaseId]/test">) {
  const { knowledgeBaseId } = await params;
  return <KnowledgeTestPanel knowledgeBaseId={knowledgeBaseId} />;
}
