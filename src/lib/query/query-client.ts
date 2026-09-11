import { defaultShouldDehydrateQuery, QueryClient } from "@tanstack/react-query";

import { isApiError } from "@/lib/api/api-error";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Server-provided data stays fresh long enough to avoid an immediate
        // client refetch after hydration.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Client errors (4xx) are deterministic; only retry transient failures.
          if (isApiError(error) && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Server renders get an isolated client per request; the browser reuses one
 * client so the cache survives navigations and re-renders.
 */
export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
