"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AppToaster } from "@/components/feedback/app-toaster";
import { getQueryClient } from "@/lib/query/query-client";

export function AppProviders({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <AppToaster />
    </QueryClientProvider>
  );
}
