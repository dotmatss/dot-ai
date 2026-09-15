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
        // Everything here is outbound. API keys and Embeds are the inbound
        // direction and live under Developer.
        { href: `${base}/credentials` as Route, label: "Credentials" },
        { href: `${base}/mcp` as Route, label: "MCP" },
      ]}
    />
  );
}
