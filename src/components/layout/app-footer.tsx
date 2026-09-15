import type { Route } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/layout/brand-logo";
import { ThemeSelector } from "@/components/layout/theme-selector";
import { siteConfig } from "@/config/site";
import { legalLinks } from "@/features/legal/registry";

/**
 * The footer for every public page.
 *
 * One component, composed by the public layout, so the landing page, the
 * documentation and the legal pages cannot drift apart. The legal row is
 * rendered from the legal registry rather than hard-coded, which is what makes
 * the cookie link appear only while there is a cookie policy to link to.
 */
const GROUPS = [
  {
    title: "Product",
    links: [
      { href: "/#capabilities", label: "Capabilities" },
      { href: "/#integrations", label: "Embed and API" },
      { href: "/pricing", label: "Pricing" },
      { href: "/sign-up", label: "Get started" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/docs/api/authentication", label: "API keys" },
      { href: "/docs/api/chat", label: "Chat API" },
      { href: "/docs/embed", label: "Website embed" },
    ],
  },
  {
    title: "Platform",
    links: [
      { href: "/docs/chatbots", label: "Chatbots" },
      { href: "/docs/agents", label: "Agents" },
      { href: "/docs/workflows", label: "Workflows" },
      { href: "/docs/knowledge", label: "Knowledge" },
    ],
  },
] as const;

export function AppFooter() {
  const legal = legalLinks();

  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5 rounded-md focus-ring">
              <BrandMark />
              <span className="text-sm font-semibold tracking-tight">{siteConfig.name}</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-6 text-foreground-muted">{siteConfig.description}</p>
            <ThemeSelector className="mt-7" />
          </div>

          {GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="text-caption font-medium uppercase tracking-caption text-foreground-muted">{group.title}</h2>
              <ul className="mt-4 flex flex-col gap-2.5">
                {group.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link
                      href={link.href}
                      className="rounded-xs text-sm text-foreground-secondary transition-colors hover:text-foreground focus-ring"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-foreground-subtle">
            © {new Date().getFullYear()} {siteConfig.name}. All rights reserved.
          </p>
          <nav aria-label="Legal">
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {legal.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href as Route}
                    className="rounded-xs text-xs text-foreground-muted transition-colors hover:text-foreground focus-ring"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href={"/docs" as Route}
                  className="rounded-xs text-xs text-foreground-muted transition-colors hover:text-foreground focus-ring"
                >
                  Documentation
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}
