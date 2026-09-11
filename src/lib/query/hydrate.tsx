import { dehydrate, HydrationBoundary, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Hands server-loaded query data to Client Components. Pages seed a request
 * scoped QueryClient (via `setQueryData` / `prefetchQuery`) and wrap the client
 * tree so the first render has data without a client round-trip.
 */
export function HydrateClient({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>;
}
