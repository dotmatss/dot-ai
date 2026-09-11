import { AppOverline } from "@/components/ui/app-typography";
import { KNOWLEDGE_LIFECYCLE } from "@/features/knowledge/constants";

/**
 * What happens to a source, start to finish. An ordered list carries the
 * sequence semantically, so a screen reader announces "1 of 8" rather than
 * relying on the arrows, which are decorative.
 */
export function KnowledgeLifecycle({ className }: { className?: string }) {
  return (
    <section className={className} aria-labelledby="knowledge-lifecycle-heading">
      <AppOverline id="knowledge-lifecycle-heading" className="block">
        How your content becomes an answer
      </AppOverline>
      <ol className="mt-3 flex flex-col gap-0">
        {KNOWLEDGE_LIFECYCLE.map((stage, index) => (
          <li key={stage.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-caption font-semibold tabular-nums text-foreground-secondary">
                {index + 1}
              </span>
              {index < KNOWLEDGE_LIFECYCLE.length - 1 ? <span aria-hidden className="w-px flex-1 bg-border" /> : null}
            </div>
            <div className="min-w-0 pb-4">
              <p className="text-sm font-medium text-foreground">{stage.label}</p>
              <p className="text-xs text-foreground-muted">{stage.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
