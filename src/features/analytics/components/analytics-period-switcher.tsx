"use client";

import { AppChip } from "@/components/ui/app-chip";
import { DEFAULT_ANALYTICS_PERIOD, PERIOD_META } from "@/features/analytics/constants";
import { ANALYTICS_FILTER_KEYS, parseAnalyticsPeriod } from "@/features/analytics/filters";
import { ANALYTICS_PERIODS } from "@/features/analytics/types";
import { useSearchParamState } from "@/hooks/use-search-param-state";

/**
 * The only interactive part of the page.
 *
 * The period is read-only server state, so this writes it to the URL and lets
 * the server re-render every section for the new window - there is no client
 * fetch and no analytics endpoint. The default period is written as an *absent*
 * param so a shared link carries a query string only when it means something.
 */
export function AnalyticsPeriodSwitcher() {
  const [params, setParams] = useSearchParamState(ANALYTICS_FILTER_KEYS);
  const period = parseAnalyticsPeriod(params.period);

  return (
    <div role="group" aria-label="Analytics period" className="flex flex-wrap items-center gap-2">
      {ANALYTICS_PERIODS.map((option) => {
        const meta = PERIOD_META[option];
        return (
          <AppChip
            key={option}
            selected={period === option}
            title={meta.label}
            onClick={() => setParams({ period: option === DEFAULT_ANALYTICS_PERIOD ? undefined : option })}
          >
            {meta.shortLabel}
            <span className="sr-only"> ({meta.label})</span>
          </AppChip>
        );
      })}
    </div>
  );
}
