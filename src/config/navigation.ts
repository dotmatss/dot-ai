import {
  BarChart3,
  BookOpen,
  Bot,
  Cpu,
  LayoutDashboard,
  MessagesSquare,
  Plug,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  href: (workspaceSlug: string) => Route;
  /** Match nested routes (default true). */
  matchPrefix?: boolean;
}

export interface NavGroup {
  key: string;
  label?: string;
  items: NavItem[];
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
    ],
  },
  {
    key: "manage",
    label: "Manage",
    items: [
      { key: "integrations", label: "Integrations", icon: Plug, href: (slug) => `/w/${slug}/integrations` as Route },
      { key: "analytics", label: "Analytics", icon: BarChart3, href: (slug) => `/w/${slug}/analytics` as Route },
      { key: "settings", label: "Settings", icon: Settings, href: (slug) => `/w/${slug}/settings` as Route },
    ],
  },
];

export function isNavItemActive(pathname: string, href: string, matchPrefix = true): boolean {
  if (pathname === href) return true;
  return matchPrefix && pathname.startsWith(`${href}/`);
}
