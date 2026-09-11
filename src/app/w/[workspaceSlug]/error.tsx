"use client";

import { useEffect } from "react";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { PageContainer } from "@/components/layout/page-container";

export default function WorkspaceError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // Hook for error tracking (e.g. Sentry) once a provider is chosen.
    console.error(error);
  }, [error]);

  return (
    <PageContainer>
      <AppErrorState
        title="This page could not be loaded"
        description={error.digest ? `Reference: ${error.digest}` : error.message}
        onRetry={retry}
      />
    </PageContainer>
  );
}
