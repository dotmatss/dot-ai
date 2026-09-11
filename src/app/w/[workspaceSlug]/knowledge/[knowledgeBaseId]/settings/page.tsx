import type { Metadata } from "next";

import { KnowledgeSettingsForm } from "@/features/knowledge/components/knowledge-settings-form";

export const metadata: Metadata = { title: "Knowledge base settings" };

export default async function KnowledgeSettingsPage({
  params,
}: PageProps<"/w/[workspaceSlug]/knowledge/[knowledgeBaseId]/settings">) {
  const { knowledgeBaseId } = await params;
  return <KnowledgeSettingsForm knowledgeBaseId={knowledgeBaseId} />;
}
