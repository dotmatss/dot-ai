import { ArrowRight } from "lucide-react";

import { AppButtonLink } from "@/components/ui/app-button";
import { ChatPreview } from "@/features/marketing/components/bento-visuals";

/**
 * Above the fold: what the product is, who it is for, and the two ways to
 * deploy it. Static and server rendered — no client JavaScript at all.
 */
export function HeroSection() {
  return (
    <section className="border-b border-border bg-surface">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-16 lg:px-8 lg:py-28">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-caption font-medium uppercase tracking-[0.08em] text-foreground-muted">
            AI chatbots, agents and workflows
          </p>

          <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Put your own AI assistant in front of customers
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-8 text-foreground-secondary">
            Build a chatbot on your own content, test it against the exact configuration you are about to publish, then
            embed it on your site or call it from your application. One platform for the whole loop.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <AppButtonLink href="/sign-up" size="lg" trailingIcon={<ArrowRight aria-hidden />}>
              Start building
            </AppButtonLink>
            <AppButtonLink href="/docs" size="lg" variant="secondary">
              Read the docs
            </AppButtonLink>
          </div>

          <dl className="mt-12 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-border pt-8 sm:grid-cols-3">
            {[
              { term: "Grounded", detail: "Answers cite the knowledge they came from" },
              { term: "Two ways out", detail: "Website embed or a server-to-server API" },
              { term: "Tenant isolated", detail: "Every workspace separated in the database" },
            ].map((item) => (
              <div key={item.term}>
                <dt className="text-sm font-semibold text-foreground">{item.term}</dt>
                <dd className="mt-1 text-sm leading-6 text-foreground-muted">{item.detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative">
          <div className="rounded-2xl border border-border bg-background p-3 shadow-lg">
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 items-center justify-center rounded-md bg-accent text-xs font-semibold text-accent-foreground">
                    S
                  </span>
                  <div>
                    <p className="text-sm font-semibold leading-4">Support Assistant</p>
                    <p className="text-caption text-foreground-muted">Active · 2 collectiones</p>
                  </div>
                </div>
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-success-border bg-success-bg px-2.5 text-caption font-medium text-success">
                  <span aria-hidden className="size-1.5 rounded-full bg-success" />
                  Live
                </span>
              </div>
              <div className="pt-4">
                <ChatPreview />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
