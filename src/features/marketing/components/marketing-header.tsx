import Link from "next/link";

import { BrandMark } from "@/components/layout/brand-logo";
import { AppButtonLink } from "@/components/ui/app-button";
import { siteConfig } from "@/config/site";

const LINKS = [
  { href: "/#capabilities", label: "Capabilities" },
  { href: "/#integrations", label: "Integrations" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
] as const;

/**
 * Public header.
 *
 * Deliberately does not read the session: doing so would opt every marketing
 * page into dynamic rendering for a cosmetic difference. A signed-in visitor
 * who clicks "Sign in" is sent straight to their dashboard by the sign-in page.
 */
export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur supports-backdrop-filter:bg-surface/75">
      <div className="mx-auto flex h-topbar w-full max-w-6xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="inline-flex items-center gap-2.5 rounded-md focus-ring">
          <BrandMark />
          <span className="text-sm font-semibold tracking-tight">{siteConfig.name}</span>
        </Link>

        <nav aria-label="Main" className="hidden flex-1 items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:bg-surface-muted hover:text-foreground focus-ring"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Link
            href="/docs"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:bg-surface-muted hover:text-foreground focus-ring md:hidden"
          >
            Docs
          </Link>
          <AppButtonLink href="/sign-in" variant="ghost" size="sm">
            Sign in
          </AppButtonLink>
          <AppButtonLink href="/sign-up" size="sm">
            Get started
          </AppButtonLink>
        </div>
      </div>
    </header>
  );
}
