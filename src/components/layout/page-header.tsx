import { ChevronLeft } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppHeading } from "@/components/ui/app-typography";
import { cn } from "@/lib/cn";

interface Breadcrumb {
  label: string;
  href?: Route;
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Breadcrumb[];
  backHref?: Route;
  backLabel?: string;
  /** Rendered beneath the header, e.g. tab navigation. */
  children?: ReactNode;
  leading?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  backHref,
  backLabel = "Back",
  children,
  leading,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1.5 text-xs text-foreground-muted">
            {breadcrumbs.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1;
              return (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                  {crumb.href && !last ? (
                    <Link href={crumb.href} className="hover:text-foreground focus-ring rounded-xs">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current={last ? "page" : undefined} className={cn(last && "text-foreground")}>
                      {crumb.label}
                    </span>
                  )}
                  {!last ? <span aria-hidden>/</span> : null}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}
      {backHref ? (
        <Link
          href={backHref}
          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-foreground-muted hover:text-foreground focus-ring rounded-xs"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          {backLabel}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {leading}
          <div className="min-w-0">
            <AppHeading level={1} className="truncate text-2xl sm:text-3xl">
              {title}
            </AppHeading>
            {description ? <p className="mt-1 max-w-2xl text-sm text-foreground-muted">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
