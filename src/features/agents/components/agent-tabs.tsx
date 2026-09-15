"use client";

import type { Route } from "next";

import { AppTabNav } from "@/components/ui/app-tabs";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export function AgentTabs({ agentId }: { agentId: string }) {
  const { membership } = useWorkspace();
  const base = `/w/${membership.workspace.slug}/agents/${agentId}`;
  return (
    <AppTabNav
      label="Agent sections"
      items={[
        { href: base as Route, label: "Overview" },
        { href: `${base}/instructions` as Route, label: "Instructions" },
        { href: `${base}/tools` as Route, label: "Tools" },
        { href: `${base}/knowledge` as Route, label: "Knowledge" },
        { href: `${base}/delegation` as Route, label: "Delegation" },
        { href: `${base}/memory` as Route, label: "Memory & output" },
        { href: `${base}/playground` as Route, label: "Playground" },
        { href: `${base}/settings` as Route, label: "Settings" },
      ]}
    />
  );
}
