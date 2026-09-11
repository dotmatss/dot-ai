"use client";

import { Search } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type KeyboardEvent } from "react";

import { AppInput } from "@/components/ui/app-input";
import { searchDocs } from "@/features/docs/search-index";
import { cn } from "@/lib/cn";

/**
 * Documentation search.
 *
 * A combobox over the in-memory index, driven with aria-activedescendant so
 * results stay reachable from the keyboard without moving focus out of the
 * input — moving focus would close the list before a click could land.
 */
export function DocsSearch() {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const results = useMemo(() => searchDocs(query), [query]);
  const open = focused && query.trim().length > 0;
  const active = Math.min(activeIndex, Math.max(0, results.length - 1));

  function go(index: number) {
    const target = results[index];
    if (!target) return;
    router.push(`/docs/${target.slug}` as Route);
    setQuery("");
    setFocused(false);
    setActiveIndex(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % results.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + results.length) % results.length);
        break;
      case "Enter":
        event.preventDefault();
        go(active);
        break;
      case "Escape":
        event.preventDefault();
        setQuery("");
        break;
      default:
        break;
    }
  }

  return (
    <div className="relative">
      <AppInput
        type="search"
        role="combobox"
        aria-label="Search documentation"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && results.length > 0 ? `${listId}-option-${active}` : undefined}
        aria-autocomplete="list"
        placeholder="Search docs…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onKeyDown={onKeyDown}
        leadingIcon={<Search aria-hidden />}
        className="[&::-webkit-search-cancel-button]:hidden"
      />

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-foreground-muted">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            results.map((result, index) => (
              <div
                key={result.slug}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => go(index)}
                className={cn(
                  "cursor-pointer rounded-md px-3 py-2",
                  index === active && "bg-surface-muted",
                )}
              >
                <p className="text-sm font-medium text-foreground">{result.title}</p>
                <p className="truncate text-xs text-foreground-muted">
                  {result.section} · {result.description}
                </p>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
