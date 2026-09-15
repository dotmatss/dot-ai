import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";

import { AppButtonLink } from "@/components/ui/app-button";
import { DOC_SECTIONS } from "@/features/docs/registry";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Documentation",
  description: `Build, deploy and integrate AI chatbots, agents and workflows with ${siteConfig.name}.`,
  alternates: { canonical: "/docs" },
};

export default function DocsIndexPage() {
  return (
    <div className="min-w-0">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">Documentation</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-foreground-secondary">
          Everything needed to build an assistant on your own content and put it in front of customers — on your website
          or through the API.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <AppButtonLink href={"/docs/getting-started" as Route}>Quickstart</AppButtonLink>
          <AppButtonLink href={"/docs/api/authentication" as Route} variant="secondary">
            API keys
          </AppButtonLink>
        </div>
      </header>

      <div className="flex flex-col gap-10">
        {DOC_SECTIONS.map((section) => (
          <section key={section.title} aria-labelledby={`section-${section.title.replace(/\s+/g, "-").toLowerCase()}`}>
            <h2
              id={`section-${section.title.replace(/\s+/g, "-").toLowerCase()}`}
              className="text-caption font-medium uppercase tracking-caption text-foreground-muted"
            >
              {section.title}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {section.pages.map((page) => (
                <Link
                  key={page.slug}
                  href={`/docs/${page.slug}` as Route}
                  className="group rounded-lg border border-border bg-surface p-4 transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-xs focus-ring"
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    {page.title}
                    <ArrowUpRight
                      aria-hidden
                      className="size-3.5 text-foreground-subtle transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-foreground-muted">{page.description}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
