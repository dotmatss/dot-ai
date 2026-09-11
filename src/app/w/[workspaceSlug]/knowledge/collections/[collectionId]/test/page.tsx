import type { Metadata } from "next";

import { KnowledgeTestPanel } from "@/features/knowledge/components/knowledge-test-panel";

export const metadata: Metadata = { title: "Test retrieval" };

export default async function CollectionTestPage({
  params,
}: PageProps<"/w/[workspaceSlug]/knowledge/collections/[collectionId]/test">) {
  const { collectionId } = await params;
  return <KnowledgeTestPanel collectionId={collectionId} />;
}
