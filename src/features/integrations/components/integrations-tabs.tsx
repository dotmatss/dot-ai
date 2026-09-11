"use client";

import type { Route } from "next";

import { AppTabNav } from "@/components/ui/app-tabs";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export function IntegrationsTabs() {
  const { membership } = useWorkspace();
  const base = `/w/${membership.workspace.slug}/integrations`;
  return (
    <AppTabNav
      label="Integration sections"
      items={[
        { href: base as Route, label: "Catalog" },
        { href: `${base}/api-keys` as Route, label: "API keys" },
        { href: `${base}/embeds` as Route, label: "Embeds" },
      ]}
    />
  );
}
