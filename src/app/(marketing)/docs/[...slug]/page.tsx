import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocBlocks } from "@/features/docs/components/doc-blocks";
import { DocsPageHeader, DocsPager, DocsToc } from "@/features/docs/components/docs-page-chrome";
import { DOC_PAGES, findDocPage, sectionOf } from "@/features/docs/registry";
import { headingsOf } from "@/features/docs/types";

/** Every documentation page is known at build time, so all of them prerender. */
export function generateStaticParams() {
  return DOC_PAGES.map((page) => ({ slug: page.slug.split("/") }));
}

export async function generateMetadata({ params }: PageProps<"/docs/[...slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = findDocPage(slug.join("/"));
  if (!page) return {};
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/docs/${page.slug}` },
    openGraph: { title: page.title, description: page.description, type: "article" },
  };
}

export default async function DocPage({ params }: PageProps<"/docs/[...slug]">) {
  const { slug } = await params;
  const key = slug.join("/");
  const page = findDocPage(key);
  if (!page) notFound();

  const section = sectionOf(key);
  const headings = headingsOf(page);

  return (
    <div className="min-w-0 xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-10">
      <article className="min-w-0 max-w-3xl">
        <DocsPageHeader page={page} section={section?.title ?? "Docs"} />
        <DocBlocks blocks={page.blocks} />
        <DocsPager slug={page.slug} />
      </article>
      <DocsToc headings={headings} />
    </div>
  );
}
