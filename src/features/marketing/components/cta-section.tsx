import { ArrowRight } from "lucide-react";
import type { Route } from "next";

import { AppButtonLink } from "@/components/ui/app-button";

export function CtaSection() {
  return (
    <section className="bg-surface-inverted" aria-labelledby="cta-heading">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <h2 id="cta-heading" className="text-3xl font-bold tracking-tight text-foreground-inverted sm:text-4xl">
            Start with one chatbot
          </h2>
          <p className="mt-4 text-base leading-7 text-foreground-inverted/75">
            Create a workspace, point it at your content, and see a grounded answer in the playground before you publish
            anything. No credit card, no sales call.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <AppButtonLink
              href="/sign-up"
              size="lg"
              variant="secondary"
              className="border-transparent bg-foreground-inverted text-surface-inverted hover:bg-foreground-inverted/90"
              trailingIcon={<ArrowRight aria-hidden />}
            >
              Create a workspace
            </AppButtonLink>
            <AppButtonLink
              href={"/docs/getting-started" as Route}
              size="lg"
              variant="ghost"
              className="text-foreground-inverted/80 hover:bg-foreground-inverted/10 hover:text-foreground-inverted"
            >
              Read the quickstart
            </AppButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
