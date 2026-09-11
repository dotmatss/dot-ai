"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { AppButton } from "@/components/ui/app-button";
import { cn } from "@/lib/cn";

interface AppPaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Optional summary such as "Showing 1–20 of 134". */
  summary?: string;
  className?: string;
}

function range(page: number, pageCount: number): Array<number | "…"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages = new Set<number>([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push("…");
    out.push(p);
    previous = p;
  }
  return out;
}

export function AppPagination({ page, pageCount, onPageChange, summary, className }: AppPaginationProps) {
  if (pageCount <= 1 && !summary) return null;
  const items = range(page, pageCount);
  return (
    <nav
      aria-label="Pagination"
      className={cn("flex flex-col-reverse items-center justify-between gap-3 sm:flex-row", className)}
    >
      {summary ? <p className="text-xs text-foreground-muted">{summary}</p> : <span />}
      {pageCount > 1 ? (
        <ul className="flex items-center gap-1">
          <li>
            <AppButton
              variant="ghost"
              size="icon-sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft aria-hidden />
            </AppButton>
          </li>
          {items.map((item, index) =>
            item === "…" ? (
              <li key={`gap-${index}`} className="px-1 text-xs text-foreground-subtle" aria-hidden>
                …
              </li>
            ) : (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => onPageChange(item)}
                  aria-current={item === page ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-medium transition-colors focus-ring",
                    item === page
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground-secondary hover:bg-surface-muted hover:text-foreground",
                  )}
                >
                  {item}
                </button>
              </li>
            ),
          )}
          <li>
            <AppButton
              variant="ghost"
              size="icon-sm"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= pageCount}
              aria-label="Next page"
            >
              <ChevronRight aria-hidden />
            </AppButton>
          </li>
        </ul>
      ) : null}
    </nav>
  );
}

export function paginationSummary(page: number, pageSize: number, total: number): string {
  if (total === 0) return "No results";
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return `Showing ${start}–${end} of ${total}`;
}
