"use client";

import type { Route } from "next";

import { AppTabNav } from "@/components/ui/app-tabs";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export function DeveloperTabs() {
  const { membership } = useWorkspace();
  const base = `/w/${membership.workspace.slug}/developer`;
  return (
    <AppTabNav
      label="Developer sections"
      items={[
        { href: base as Route, label: "API keys" },
        { href: `${base}/embeds` as Route, label: "Embeds" },
      ]}
    />
  );
}
