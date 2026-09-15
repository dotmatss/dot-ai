import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { FAQS } from "@/features/marketing/content";

/**
 * Frequently asked questions.
 *
 * A native `<details>` per question, so the section stays a Server Component
 * and the page keeps its property of shipping no client JavaScript beyond the
 * copy button in the code samples. Every answer is in the DOM whether or not
 * it is open, which is what lets the structured data below describe the page
 * truthfully.
 *
 * The FAQPage JSON-LD is generated from the same array the section renders, so
 * the copy a search engine reads cannot drift from the copy a visitor sees.
 */
export function FaqSection() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <section id="faq" className="border-b border-border bg-surface" aria-labelledby="faq-heading">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-caption font-medium uppercase tracking-caption text-foreground-muted">Questions</p>
          <h2 id="faq-heading" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Answers before you sign up
          </h2>
          <p className="mt-4 text-base leading-7 text-foreground-secondary">
            What the product does today, what it does not do yet, and where the longer version of each answer lives.
          </p>
        </div>

        <ul className="mt-12 divide-y divide-border rounded-xl border border-border bg-background">
          {FAQS.map((item) => (
            <li key={item.key}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl p-6 focus-ring [&::-webkit-details-marker]:hidden">
                  <h3 className="text-base font-semibold text-foreground">{item.question}</h3>
                  <ChevronDown
                    aria-hidden
                    className="size-4 shrink-0 text-foreground-subtle transition-transform duration-200 ease-out-soft group-open:rotate-180"
                  />
                </summary>
                <div className="px-6 pb-6">
                  <p className="max-w-3xl text-sm leading-6 text-foreground-secondary">{item.answer}</p>
                  {item.link ? (
                    <Link
                      href={item.link.href as Route}
                      className="mt-4 inline-flex items-center gap-1 rounded-xs text-sm font-medium text-foreground underline-offset-4 hover:underline focus-ring"
                    >
                      {item.link.label}
                      <ArrowUpRight aria-hidden className="size-4" />
                    </Link>
                  ) : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
    </section>
  );
}
