import type { Metadata } from "next";

import { CollectionSettingsForm } from "@/features/knowledge/components/collection-settings-form";

export const metadata: Metadata = { title: "Collection settings" };

export default async function CollectionSettingsPage({
  params,
}: PageProps<"/w/[workspaceSlug]/knowledge/collections/[collectionId]/settings">) {
  const { collectionId } = await params;
  return <CollectionSettingsForm collectionId={collectionId} />;
}
