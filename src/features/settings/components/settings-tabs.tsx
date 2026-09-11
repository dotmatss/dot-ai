"use client";

import type { Route } from "next";

import { AppTabNav } from "@/components/ui/app-tabs";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

/**
 * Workspace-level tabs first, then the two that are about the person signed in.
 * They share one section because that is where people look for both.
 */
export function SettingsTabs() {
  const { membership } = useWorkspace();
  const base = `/w/${membership.workspace.slug}/settings`;
  return (
    <AppTabNav
      label="Settings sections"
      items={[
        { href: base as Route, label: "General" },
        { href: `${base}/members` as Route, label: "Members" },
        { href: `${base}/usage` as Route, label: "Usage" },
        { href: `${base}/profile` as Route, label: "Profile" },
        { href: `${base}/security` as Route, label: "Security" },
      ]}
    />
  );
}
