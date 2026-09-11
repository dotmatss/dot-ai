import { JOURNEY } from "@/features/marketing/content";

/**
 * The product loop, stated once. Numbered steps rather than icons, because the
 * order is the point.
 */
export function HowItWorks() {
  return (
    <section className="border-b border-border bg-background" aria-labelledby="how-it-works-heading">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-caption font-medium uppercase tracking-[0.08em] text-foreground-muted">How it works</p>
          <h2 id="how-it-works-heading" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Build, ground, test, deploy, monitor
          </h2>
          <p className="mt-4 text-base leading-7 text-foreground-secondary">
            The same five steps whether you are shipping a support bot on a marketing site or an agent inside your own
            product.
          </p>
        </div>

        <ol className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
          {JOURNEY.map((item) => (
            <li key={item.step} className="flex flex-col bg-surface p-6">
              <span className="font-mono text-xs text-foreground-subtle">{item.step}</span>
              <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-foreground-secondary">{item.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
