import { Boxes, Building2, Cpu, LayoutDashboard, ScrollText, Users, type LucideIcon } from "lucide-react";
import type { Route } from "next";

/**
 * Navigation for the PLATFORM plane.
 *
 * Deliberately a separate list from `workspaceNavigation`, not a role-filtered
 * view of it. The two planes manage different things for different people, and
 * merging them would put "suspend this tenant" one `minimumRole` typo away from
 * a customer's sidebar.
 *
 * There is no `minimumRole` field here either, and its absence is the point:
 * inside /admin there is exactly one privilege level. Everything listed is
 * reachable by any platform admin and by nobody else, so a per-item floor would
 * imply a distinction that the authorization model does not make.
 *
 * Only sections that EXIST are listed. The control plane's later phases (AI
 * providers, models, routing, billing, feature flags) are deliberately absent
 * rather than present and dead: a navigation item that leads nowhere teaches an
 * operator that the plane is unfinished, and teaches the next engineer that a
 * stub is an acceptable thing to ship.
 */

export interface PlatformNavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  href: Route;
  /** Match nested routes. Overview is exact, or every page would look active. */
  matchPrefix?: boolean;
}

export const platformNavigation: PlatformNavItem[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, href: "/admin" as Route, matchPrefix: false },
  { key: "organizations", label: "Organizations", icon: Building2, href: "/admin/organizations" as Route },
  { key: "users", label: "Users", icon: Users, href: "/admin/users" as Route },
  { key: "ai-providers", label: "Providers", icon: Cpu, href: "/admin/ai/providers" as Route },
  { key: "ai-models", label: "Models", icon: Boxes, href: "/admin/ai/models" as Route },
  { key: "ai-embeddings", label: "Embeddings", icon: Boxes, href: "/admin/ai/embeddings" as Route },
  { key: "audit", label: "Audit logs", icon: ScrollText, href: "/admin/audit" as Route },
];

export function isPlatformNavItemActive(pathname: string, item: PlatformNavItem): boolean {
  if (pathname === item.href) return true;
  return (item.matchPrefix ?? true) && pathname.startsWith(`${item.href}/`);
}
