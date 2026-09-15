"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isPlatformNavItemActive, platformNavigation } from "@/config/platform-navigation";
import { cn } from "@/lib/cn";

/**
 * The platform plane's navigation.
 *
 * A Client Component only because the active item depends on the current path.
 * It renders links and nothing else - no data, no session, no capability - so
 * it carries nothing that a customer bundle would not already be allowed to see
 * if this file were ever imported outside /admin.
 */
export function PlatformNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Platform administration">
      <ul className="flex flex-wrap gap-1">
        {platformNavigation.map((item) => {
          const active = isPlatformNavItemActive(pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-surface-muted font-medium text-foreground"
                    : "text-foreground-secondary hover:bg-surface-muted hover:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-4" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
