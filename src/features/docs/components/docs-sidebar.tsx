"use client";

import { Menu, X } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { AppButton } from "@/components/ui/app-button";
import { DocsSearch } from "@/features/docs/components/docs-search";
import { DOC_SECTIONS } from "@/features/docs/registry";
import { cn } from "@/lib/cn";

function NavTree({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Documentation" className="flex flex-col gap-6">
      {DOC_SECTIONS.map((section) => (
        <div key={section.title}>
          <h2 className="px-2.5 text-caption font-medium uppercase tracking-caption text-foreground-subtle">
            {section.title}
          </h2>
          <ul className="mt-2 flex flex-col gap-0.5">
            {section.pages.map((page) => {
              const href = `/docs/${page.slug}`;
              const current = pathname === href;
              return (
                <li key={page.slug}>
                  <Link
                    href={href as Route}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2.5 py-1.5 text-sm transition-colors focus-ring",
                      current
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-foreground-secondary hover:bg-surface-muted hover:text-foreground",
                    )}
                  >
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DocsSidebar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Mobile: a disclosure above the content rather than a drawer, so the
          page stays scrollable and focus never gets trapped. */}
      <div className="lg:hidden">
        <div className="flex items-center gap-2">
          <AppButton
            variant="secondary"
            size="sm"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="docs-mobile-nav"
            leadingIcon={open ? <X aria-hidden /> : <Menu aria-hidden />}
          >
            {open ? "Close" : "Browse docs"}
          </AppButton>
          <div className="min-w-0 flex-1">
            <DocsSearch />
          </div>
        </div>
        {open ? (
          <div id="docs-mobile-nav" className="mt-4 rounded-lg border border-border bg-surface p-3">
            <NavTree onNavigate={() => setOpen(false)} />
          </div>
        ) : null}
      </div>

      <div className="hidden lg:block">
        <div className="sticky top-[calc(var(--spacing-topbar)+1.5rem)] flex max-h-[calc(100dvh-var(--spacing-topbar)-3rem)] flex-col gap-5 overflow-y-auto pb-8 scrollbar-thin">
          <DocsSearch />
          <NavTree />
        </div>
      </div>
    </>
  );
}
