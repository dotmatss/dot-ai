"use client";

import { BookOpenCheck, MessagesSquare, ShieldCheck, TriangleAlert } from "lucide-react";

import { AppStat } from "@/components/ui/app-stat";
import { AppTooltip } from "@/components/ui/app-tooltip";
import { formatRate, overviewContainmentRate, overviewCoverageRate } from "@/features/intelligence/metrics";
import { useIntelligenceOverviewQuery } from "@/features/intelligence/queries";
import type { IntelligenceOverview } from "@/features/intelligence/types";

/**
 * The workspace rollup.
 *
 * A Client Component reading a query the server page has already seeded, so the
 * first paint costs no request. It is not a Server Component, and the reason is
 * the one thing that changes these numbers: finishing a run invalidates the
 * query and these tiles update with the topic list beneath them. Rendered on
 * the server they would keep showing the previous run's figures above a table
 * showing the new one's, until something else happened to refresh the route.
 *
 * Every tile shows the RATE as the headline and the counts underneath. A
 * containment rate with no denominator is the kind of number that gets quoted
 * in a board deck and cannot be checked.
 */
export function IntelligenceStats({ overview: seeded }: { overview: IntelligenceOverview }) {
  const query = useIntelligenceOverviewQuery();
  const overview = query.data ?? seeded;
  const analyzed = overview.conversationsAnalyzed;
  const containment = overviewContainmentRate(overview);
  const coverage = overviewCoverageRate(overview);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <AppStat
        label="Conversations analyzed"
        value={analyzed.toLocaleString("en")}
        hint={<MessagesSquare className="size-4 text-foreground-subtle" aria-hidden />}
        visual={
          <p className="text-xs text-foreground-muted">
            across {overview.topicCount.toLocaleString("en")} topic{overview.topicCount === 1 ? "" : "s"}
          </p>
        }
      />
      <AppStat
        label="Contained"
        value={analyzed === 0 ? "—" : formatRate(containment)}
        hint={
          <AppTooltip content="Resolved without a team member replying. A human reply counts as a hand-off however the thread was later marked.">
            <span tabIndex={0} className="rounded-full focus-ring" aria-label="How containment is measured">
              <ShieldCheck className="size-4 text-foreground-subtle" aria-hidden />
            </span>
          </AppTooltip>
        }
        visual={
          <p className="text-xs text-foreground-muted">
            {overview.containedCount.toLocaleString("en")} contained · {overview.handedOffCount.toLocaleString("en")} handed off
          </p>
        }
      />
      <AppStat
        label="Answered from knowledge"
        value={analyzed === 0 ? "—" : formatRate(coverage)}
        hint={
          <AppTooltip content="At least one reply in the thread cited a knowledge source. The rest were answered from the model's own weights.">
            <span tabIndex={0} className="rounded-full focus-ring" aria-label="How coverage is measured">
              <BookOpenCheck className="size-4 text-foreground-subtle" aria-hidden />
            </span>
          </AppTooltip>
        }
        visual={
          <p className="text-xs text-foreground-muted">
            {(analyzed - overview.groundedCount).toLocaleString("en")} with no supporting document
          </p>
        }
      />
      <AppStat
        label="Knowledge gaps"
        value={overview.gapTopicCount.toLocaleString("en")}
        hint={<TriangleAlert className="size-4 text-foreground-subtle" aria-hidden />}
        visual={
          <p className="text-xs text-foreground-muted">
            {overview.gapTopicCount === 0
              ? "No topic is short of documentation."
              : "Topics worth writing an article about."}
          </p>
        }
      />
    </div>
  );
}
