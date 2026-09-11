"use client";

import { useEffect } from "react";

import { AppErrorState } from "@/components/feedback/app-error-state";

export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <AppErrorState
        title="Something went wrong"
        description={error.digest ? `Reference: ${error.digest}` : error.message}
        onRetry={retry}
      />
    </main>
  );
}
