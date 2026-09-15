import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { AppBadge } from "@/components/ui/app-badge";
import { neighboursOf } from "@/features/docs/registry";
import type { DocHeading, DocPage } from "@/features/docs/types";

export function DocsBreadcrumbs({ section, title }: { section: string; title: string }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-foreground-muted">
        <li>
          <Link href="/docs" className="rounded-xs hover:text-foreground focus-ring">
            Docs
          </Link>
        </li>
        <li aria-hidden>/</li>
        <li>{section}</li>
        <li aria-hidden>/</li>
        <li aria-current="page" className="text-foreground">
          {title}
        </li>
      </ol>
    </nav>
  );
}

/**
 * On-page table of contents.
 *
 * A plain list of links rather than a scroll-spy: it costs no client
 * JavaScript, and the browser's own fragment navigation already does the
 * useful half of the job.
 */
export function DocsToc({ headings }: { headings: DocHeading[] }) {
  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page" className="hidden xl:block">
      <div className="sticky top-[calc(var(--spacing-topbar)+1.5rem)]">
        <h2 className="text-caption font-medium uppercase tracking-caption text-foreground-subtle">On this page</h2>
        <ul className="mt-3 flex flex-col gap-2 border-l border-border">
          {headings.map((heading) => (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                className="-ml-px block border-l border-transparent pl-3 text-sm leading-5 text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground focus-ring rounded-xs"
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

export function DocsPager({ slug }: { slug: string }) {
  const { previous, next } = neighboursOf(slug);
  if (!previous && !next) return null;

  return (
    <nav aria-label="Pagination" className="mt-16 grid gap-3 border-t border-border pt-8 sm:grid-cols-2">
      {previous ? (
        <Link
          href={`/docs/${previous.slug}` as Route}
          className="group flex flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong focus-ring"
        >
          <span className="inline-flex items-center gap-1.5 text-xs text-foreground-muted">
            <ArrowLeft aria-hidden className="size-3.5" />
            Previous
          </span>
          <span className="mt-1 text-sm font-medium text-foreground">{previous.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={`/docs/${next.slug}` as Route}
          className="group flex flex-col rounded-lg border border-border bg-surface p-4 text-right transition-colors hover:border-border-strong focus-ring sm:col-start-2"
        >
          <span className="inline-flex items-center justify-end gap-1.5 text-xs text-foreground-muted">
            Next
            <ArrowRight aria-hidden className="size-3.5" />
          </span>
          <span className="mt-1 text-sm font-medium text-foreground">{next.title}</span>
        </Link>
      ) : null}
    </nav>
  );
}

export function DocsPageHeader({ page, section }: { page: DocPage; section: string }) {
  return (
    <header className="mb-10">
      <DocsBreadcrumbs section={section} title={page.title} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{page.title}</h1>
        {page.status === "proposed" ? (
          <AppBadge tone="warning" variant="outline">
            Proposed — not implemented
          </AppBadge>
        ) : null}
      </div>
      <p className="mt-3 text-base leading-7 text-foreground-secondary">{page.description}</p>
    </header>
  );
}
