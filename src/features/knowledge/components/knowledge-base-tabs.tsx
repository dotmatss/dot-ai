"use client";

import type { Route } from "next";

import { AppTabNav } from "@/components/ui/app-tabs";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export function KnowledgeBaseTabs({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const { membership } = useWorkspace();
  const base = `/w/${membership.workspace.slug}/knowledge/${knowledgeBaseId}`;
  return (
    <AppTabNav
      label="Knowledge base sections"
      items={[
        { href: base as Route, label: "Sources" },
        { href: `${base}/test` as Route, label: "Test retrieval" },
        { href: `${base}/settings` as Route, label: "Settings" },
      ]}
    />
  );
}
