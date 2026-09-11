"use client";

import type { Route } from "next";

import { AppTabNav } from "@/components/ui/app-tabs";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export function CollectionTabs({ collectionId }: { collectionId: string }) {
  const { membership } = useWorkspace();
  const base = `/w/${membership.workspace.slug}/knowledge/collections/${collectionId}`;
  return (
    <AppTabNav
      label="Collection sections"
      items={[
        { href: base as Route, label: "Sources" },
        { href: `${base}/test` as Route, label: "Test retrieval" },
        { href: `${base}/settings` as Route, label: "Settings" },
      ]}
    />
  );
}
