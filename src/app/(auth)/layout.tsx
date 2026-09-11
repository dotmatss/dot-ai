import Link from "next/link";

import { BrandMark } from "@/components/layout/brand-logo";
import { siteConfig } from "@/config/site";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-topbar items-center px-6">
        <Link href="/" className="inline-flex items-center gap-2.5 rounded-md focus-ring">
          <BrandMark />
          <span className="text-sm font-semibold tracking-tight">{siteConfig.name}</span>
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="px-6 py-6 text-center text-xs text-foreground-subtle">
        © {new Date().getFullYear()} {siteConfig.name}. All rights reserved.
      </footer>
    </div>
  );
}
