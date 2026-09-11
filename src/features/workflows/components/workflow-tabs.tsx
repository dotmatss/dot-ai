"use client";

import type { Route } from "next";

import { AppTabNav } from "@/components/ui/app-tabs";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export function WorkflowTabs({ workflowId }: { workflowId: string }) {
  const { membership } = useWorkspace();
  const base = `/w/${membership.workspace.slug}/workflows/${workflowId}`;
  return (
    <AppTabNav
      label="Workflow sections"
      items={[
        { href: base as Route, label: "Builder" },
        { href: `${base}/runs` as Route, label: "Runs", matchPrefix: true },
        { href: `${base}/settings` as Route, label: "Settings" },
      ]}
    />
  );
}
