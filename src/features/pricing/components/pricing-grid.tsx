"use client";

import { useState } from "react";

import { BillingIntervalToggle } from "@/features/pricing/components/billing-interval-toggle";
import { PricingCard } from "@/features/pricing/components/pricing-card";
import { PLANS } from "@/features/pricing/plans";
import type { BillingInterval, Plan } from "@/features/pricing/types";

/**
 * The plan cards and the interval switch.
 *
 * The chosen interval is local UI state: it affects nothing outside this
 * section, is not server data, and is not shared with any other part of the
 * application. `useState` is the whole requirement. It is deliberately not in
 * a store and not in the URL.
 *
 * This is the only client component on the pricing page. Everything else,
 * including the comparison table, renders on the server.
 */
export function PricingGrid({ plans = PLANS }: { plans?: ReadonlyArray<Plan> }) {
  const [interval, setInterval] = useState<BillingInterval>("monthly");

  return (
    <div className="flex flex-col gap-8">
      <BillingIntervalToggle value={interval} onChange={setInterval} />

      <ul aria-label="Plans" className="grid gap-5 lg:grid-cols-3">
        {plans.map((plan) => (
          <li key={plan.id} className="h-full">
            <PricingCard plan={plan} interval={interval} />
          </li>
        ))}
      </ul>
    </div>
  );
}
