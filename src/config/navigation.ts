import {
  BarChart3,
  BookOpen,
  Bot,
  Code2,
  Cpu,
  LayoutDashboard,
  MessagesSquare,
  Plug,
  Settings,
  Telescope,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";

import { hasMinimumRole, type MemberRole } from "@/features/workspaces/roles";

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  href: (workspaceSlug: string) => Route;
  /** Match nested routes (default true). */
  matchPrefix?: boolean;
  /**
   * Role needed to see this item, defaulting to `viewer` - i.e. everyone.
   *
   * This is presentation only. The page behind the item re-checks with
   * `requireWorkspaceAccess(slug, role)` and its API handlers with
   * `workspaceRoute(handler, { minimumRole })`; hiding a link has never been
   * an access control.
   */
  minimumRole?: MemberRole;
}

export interface NavGroup {
  key: string;
  label?: string;
  items: NavItem[];
}

/** Items of any shape that carries an optional floor: nav items, tabs. */
export function visibleForRole<T extends { minimumRole?: MemberRole }>(items: ReadonlyArray<T>, role: MemberRole): T[] {
  return items.filter((item) => hasMinimumRole(role, item.minimumRole ?? "viewer"));
}

export const workspaceNavigation: NavGroup[] = [
  {
    key: "overview",
    items: [
      {
        key: "dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        href: (slug) => `/w/${slug}/dashboard` as Route,
      },
    ],
  },
  {
    key: "build",
    label: "Build",
    items: [
      { key: "chatbots", label: "Chatbots", icon: Bot, href: (slug) => `/w/${slug}/chatbots` as Route },
      { key: "agents", label: "Agents", icon: Cpu, href: (slug) => `/w/${slug}/agents` as Route },
      { key: "workflows", label: "Workflows", icon: Workflow, href: (slug) => `/w/${slug}/workflows` as Route },
      { key: "knowledge", label: "Knowledge", icon: BookOpen, href: (slug) => `/w/${slug}/knowledge` as Route },
    ],
  },
  {
    key: "engage",
    label: "Engage",
    items: [
      {
        key: "conversations",
        label: "Conversations",
        icon: MessagesSquare,
        href: (slug) => `/w/${slug}/conversations` as Route,
      },
      { key: "crm", label: "CRM", icon: Users, href: (slug) => `/w/${slug}/crm` as Route },
      {
        key: "intelligence",
        label: "Intelligence",
        icon: Telescope,
        href: (slug) => `/w/${slug}/intelligence` as Route,
      },
    ],
  },
  {
    key: "manage",
    label: "Manage",
    items: [
      // Integrations and Developer are the two directions of the same idea and
      // sit next to each other on purpose: Integrations is what this workspace
      // reaches out to, Developer is how a customer's own systems reach in.
      // They were one section until the outbound credential store made "API
      // keys" and "Credentials" neighbouring tabs that meant opposite things.
      { key: "integrations", label: "Integrations", icon: Plug, href: (slug) => `/w/${slug}/integrations` as Route },
      { key: "developer", label: "Developer", icon: Code2, href: (slug) => `/w/${slug}/developer` as Route },
      { key: "analytics", label: "Analytics", icon: BarChart3, href: (slug) => `/w/${slug}/analytics` as Route },
      { key: "settings", label: "Settings", icon: Settings, href: (slug) => `/w/${slug}/settings` as Route },
    ],
  },
];

/**
 * The sidebar and the command palette for one role.
 *
 * No top-level item carries a floor today, and that is deliberate: a viewer can
 * open Settings and Integrations, they just cannot change anything there, and
 * the per-control mirrors in `member-rules.ts` and `canManage()` are what hide
 * the buttons. The filter is wired anyway so that the day an item does need a
 * floor, it is one field on the item rather than a change the palette can be
 * forgotten in - which is exactly how a "hidden" item stays reachable.
 *
 * Groups left empty are dropped, or a role would get a bare section heading.
 */
export function visibleNavigation(role: MemberRole): NavGroup[] {
  return workspaceNavigation
    .map((group) => ({ ...group, items: visibleForRole(group.items, role) }))
    .filter((group) => group.items.length > 0);
}

export function isNavItemActive(pathname: string, href: string, matchPrefix = true): boolean {
  if (pathname === href) return true;
  return matchPrefix && pathname.startsWith(`${href}/`);
}
