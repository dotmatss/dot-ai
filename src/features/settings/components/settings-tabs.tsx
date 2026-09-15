"use client";

import type { Route } from "next";

import { AppTabNav } from "@/components/ui/app-tabs";
import { visibleForRole } from "@/config/navigation";
import { SETTINGS_TABS } from "@/features/settings/constants";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

/**
 * Workspace-level tabs first, then the two that are about the person signed in.
 * They share one section because that is where people look for both.
 *
 * Filtering is cosmetic - each page re-checks with `requireWorkspaceAccess` -
 * but it matters anyway: a tab that always 403s is worse than no tab.
 */
export function SettingsTabs() {
  const { membership } = useWorkspace();
  const base = `/w/${membership.workspace.slug}/settings`;
  const items = visibleForRole(SETTINGS_TABS, membership.role).map((tab) => ({
    href: `${base}${tab.path}` as Route,
    label: tab.label,
  }));
  return <AppTabNav label="Settings sections" items={items} />;
}
