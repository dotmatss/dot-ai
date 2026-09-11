"use client";

import { useEffect } from "react";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppCard } from "@/components/ui/app-card";

/**
 * Sits inside the analytics layout, so the page header and the period switcher
 * stay usable - switching the window is itself a way out of a failed query.
 */
export default function AnalyticsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // Hook for error tracking (e.g. Sentry) once a provider is chosen.
    console.error(error);
  }, [error]);

  return (
    <AppCard>
      <AppErrorState
        title="Analytics could not be loaded"
        description={
          error.digest
            ? `One of the aggregates failed. Reference: ${error.digest}`
            : "One of the aggregates failed while it was being calculated."
        }
        onRetry={retry}
      />
    </AppCard>
  );
}
