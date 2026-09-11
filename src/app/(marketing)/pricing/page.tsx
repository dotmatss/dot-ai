import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";

import { AppAlert } from "@/components/ui/app-alert";
import { PlanComparison } from "@/features/pricing/components/plan-comparison";
import { PricingGrid } from "@/features/pricing/components/pricing-grid";
import { pricingIsDraft } from "@/features/pricing/plans";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Plans for ${siteConfig.name}. Nothing is charged while the product is in early access.`,
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: `Pricing · ${siteConfig.name}`,
    description: `Plans for ${siteConfig.name}. Nothing is charged while the product is in early access.`,
    type: "website",
  },
};

/**
 * Public pricing.
 *
 * A Server Component apart from the plan grid, which owns the interval switch.
 * The catalogue lives in `src/features/pricing/plans.ts`; nothing on this page
 * knows a price.
 *
 * The draft notice is derived from the catalogue, so it disappears by itself
 * when the plans are published rather than lingering because someone forgot to
 * remove it.
 */
export default function PricingPage() {
  const draft = pricingIsDraft();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">Pricing</h1>
        <p className="mt-5 text-lg leading-8 text-foreground-muted">
          Start free, put a chatbot on your site, and only think about a plan when it is doing real work for you.
        </p>
      </header>

      {draft ? (
        <AppAlert tone="warning" title="Pricing is not final" className="mx-auto mt-10 max-w-3xl">
          Nothing is charged today and there is no billing in the product yet. The plans below show the shape we are
          working towards; the prices and the limits are still being decided, and every undecided value is marked as
          such rather than guessed at. Every capability listed already exists and is{" "}
          <Link href={"/docs" as Route} className="rounded-xs font-medium text-foreground underline underline-offset-4 focus-ring">
            documented
          </Link>
          .
        </AppAlert>
      ) : null}

      <section className="mt-12">
        <PricingGrid />
      </section>

      <div className="mt-20">
        <PlanComparison />
      </div>

      <section aria-labelledby="pricing-questions" className="mx-auto mt-20 max-w-3xl">
        <h2 id="pricing-questions" className="text-2xl font-bold tracking-tight text-foreground">
          What we can answer today
        </h2>
        <dl className="mt-6 flex flex-col divide-y divide-border border-t border-border">
          <div className="py-5">
            <dt className="text-sm font-semibold text-foreground">What does it cost right now?</dt>
            <dd className="mt-1.5 text-sm leading-6 text-foreground-muted">
              Nothing. Billing is not implemented, no payment details are collected, and usage is measured but never
              invoiced.
            </dd>
          </div>
          <div className="py-5">
            <dt className="text-sm font-semibold text-foreground">Will I be charged without warning?</dt>
            <dd className="mt-1.5 text-sm leading-6 text-foreground-muted">
              No. Paid plans cannot start without you entering payment details, and the terms covering price, billing
              period, taxes and renewal will be published before they take effect. They will not apply retroactively.
            </dd>
          </div>
          <div className="py-5">
            <dt className="text-sm font-semibold text-foreground">Which capabilities are real today?</dt>
            <dd className="mt-1.5 text-sm leading-6 text-foreground-muted">
              All of the ones named on this page. Chatbots, agents, workflows, knowledge collections, the conversation inbox,
              the CRM, integrations and the API are built and documented. What is undecided is how much of each a given
              plan includes.
            </dd>
          </div>
          <div className="py-5">
            <dt className="text-sm font-semibold text-foreground">What happens to my data?</dt>
            <dd className="mt-1.5 text-sm leading-6 text-foreground-muted">
              Set out in the{" "}
              <Link
                href={"/privacy" as Route}
                className="rounded-xs font-medium text-foreground underline underline-offset-4 focus-ring"
              >
                Privacy Policy
              </Link>
              , which describes what the software actually stores rather than what a template says it might.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
