import { ScrollText } from "lucide-react";

import { AppAlert } from "@/components/ui/app-alert";
import { DocBlocks } from "@/features/docs/components/doc-blocks";
import { InlineText } from "@/features/docs/components/inline-text";
import { LEGAL_PLACEHOLDERS, placeholdersIn } from "@/features/legal/placeholders";
import { REVIEW_AREA_LABELS, REVIEW_NOTES } from "@/features/legal/review-notes";
import { legalHeadings, legalText, type LegalDocument } from "@/features/legal/types";

/**
 * Renders one legal document.
 *
 * The body reuses the documentation block renderer, so a policy and a
 * reference page are typeset identically and there is one place where content
 * becomes markup. What this adds on top is the honesty apparatus: the dates,
 * the contents list, the open questions, and the list of values still to be
 * supplied. Those are rendered from data, so they cannot fall out of step with
 * the text above them.
 */
export function LegalPage({ document }: { document: LegalDocument }) {
  const headings = legalHeadings(document);
  const used = new Set(placeholdersIn(legalText(document)));
  const outstanding = LEGAL_PLACEHOLDERS.filter((placeholder) => used.has(placeholder.name));
  const notes = REVIEW_NOTES.filter((note) => document.reviewAreas.includes(note.area));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
      <header className="flex flex-col gap-3 border-b border-border pb-8">
        <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface text-foreground-muted shadow-xs">
          <ScrollText aria-hidden className="size-5" />
        </span>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{document.title}</h1>
        <p className="text-base leading-7 text-foreground-muted">{document.description}</p>
        <dl className="mt-1 flex flex-wrap gap-x-8 gap-y-1 text-xs text-foreground-subtle">
          <div className="flex gap-1.5">
            <dt>Effective</dt>
            <dd className="text-foreground-secondary">
              <InlineText text={document.effectiveDate} />
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Last updated</dt>
            <dd className="text-foreground-secondary">{document.lastUpdated}</dd>
          </div>
        </dl>
      </header>

      {headings.length > 2 ? (
        <nav aria-label={`${document.title} contents`} className="mt-8 rounded-lg border border-border bg-surface-muted p-4">
          <h2 className="text-caption font-medium uppercase tracking-[0.08em] text-foreground-muted">On this page</h2>
          <ul className="mt-2.5 flex flex-col gap-1.5 sm:columns-2">
            {headings.map((heading) => (
              <li key={heading.id}>
                <a
                  href={`#${heading.id}`}
                  className="rounded-xs text-sm text-foreground-secondary hover:text-foreground focus-ring"
                >
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <article className="mt-10">
        <DocBlocks blocks={document.blocks} />
      </article>

      {outstanding.length > 0 ? (
        <section aria-labelledby="outstanding-values" className="mt-14 border-t border-border pt-8">
          <h2 id="outstanding-values" className="text-lg font-semibold tracking-tight text-foreground">
            Values still to be supplied
          </h2>
          <p className="mt-2 text-sm leading-6 text-foreground-muted">
            Each of these appears marked in the text above. They are deliberately blank rather than filled with a
            plausible guess, because a policy that looks finished and is not is harder to catch than one that visibly is
            not.
          </p>
          <dl className="mt-5 flex flex-col gap-3">
            {outstanding.map((placeholder) => (
              <div key={placeholder.name} className="flex flex-col gap-1 border-l-2 border-border-strong pl-4">
                <dt className="font-mono text-xs font-medium text-foreground">{placeholder.name}</dt>
                <dd className="text-sm leading-6 text-foreground-secondary">
                  {placeholder.describes}
                  <span className="text-foreground-subtle"> — {placeholder.owner}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {notes.length > 0 ? (
        <section aria-labelledby="open-questions" className="mt-12 border-t border-border pt-8">
          <h2 id="open-questions" className="text-lg font-semibold tracking-tight text-foreground">
            Open questions for legal review
          </h2>
          <AppAlert tone="warning" className="mt-4">
            This page was written from the application&rsquo;s actual behaviour. That makes it accurate about the
            software. It does not make it legal advice, and it does not make the service compliant with any particular
            law. These are the points a qualified lawyer or privacy professional needs to settle.
          </AppAlert>
          <ul className="mt-5 flex flex-col gap-5">
            {notes.map((note) => (
              <li key={note.question} className="flex flex-col gap-1.5">
                <span className="text-caption font-medium uppercase tracking-[0.08em] text-foreground-subtle">
                  {REVIEW_AREA_LABELS[note.area]}
                </span>
                <p className="text-sm leading-6 text-foreground">
                  <InlineText text={note.question} />
                </p>
                <p className="text-sm leading-6 text-foreground-muted">
                  <span className="font-medium text-foreground-secondary">What the code does today: </span>
                  {note.currentState}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
