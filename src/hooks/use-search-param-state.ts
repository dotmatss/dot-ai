"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

type ParamValue = string | number | undefined | null;

/**
 * Reads list/filter state from the URL and writes it back with `replace`, so
 * filters survive reloads and are shareable. Keys set to empty/undefined are
 * removed. Changing any filter other than `page` resets pagination.
 */
export function useSearchParamState<K extends string>(keys: readonly K[]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const values = useMemo(() => {
    const out = {} as Record<K, string | undefined>;
    for (const key of keys) {
      out[key] = searchParams.get(key) ?? undefined;
    }
    return out;
  }, [keys, searchParams]);

  const setValues = useCallback(
    (patch: Partial<Record<K, ParamValue>>, options: { resetPage?: boolean } = {}) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch) as Array<[K, ParamValue]>) {
        if (value === undefined || value === null || value === "") next.delete(key);
        else next.set(key, String(value));
      }
      const resetPage = options.resetPage ?? !("page" in patch);
      if (resetPage) next.delete("page");
      const qs = next.toString();
      router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return [values, setValues] as const;
}
