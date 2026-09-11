"use client";

import { Check, ChevronDown, Tag } from "lucide-react";

import { AppButton } from "@/components/ui/app-button";
import { AppDropdownMenu, AppDropdownMenuItem, AppDropdownMenuSeparator } from "@/components/ui/app-dropdown-menu";
import { useContactTagsQuery } from "@/features/crm/queries";
import { formatNumber } from "@/lib/format/number";

/**
 * Tag facet for the contacts list. It is a menu of actions (each item applies
 * a filter), which is why counts ride along in each item's accessible name
 * rather than sitting as static text in the panel - text inside role="menu"
 * that is not part of an item is invisible to assistive technology.
 */
export function ContactTagFilter({ selected, onSelect }: { selected?: string; onSelect: (tag: string | undefined) => void }) {
  const query = useContactTagsQuery();
  const tags = query.data ?? [];

  return (
    <AppDropdownMenu
      label="Filter by tag"
      className="max-h-80 overflow-y-auto scrollbar-thin"
      trigger={
        <AppButton variant="secondary" size="sm" leadingIcon={<Tag aria-hidden />} trailingIcon={<ChevronDown aria-hidden />}>
          {selected ? `Tag: ${selected}` : "All tags"}
        </AppButton>
      }
    >
      {selected ? (
        <>
          <AppDropdownMenuItem onSelect={() => onSelect(undefined)}>Clear tag filter</AppDropdownMenuItem>
          <AppDropdownMenuSeparator />
        </>
      ) : null}

      {query.isPending ? (
        <AppDropdownMenuItem disabled>Loading tags…</AppDropdownMenuItem>
      ) : query.isError ? (
        <AppDropdownMenuItem onSelect={() => void query.refetch()}>Could not load tags. Try again</AppDropdownMenuItem>
      ) : tags.length === 0 ? (
        <AppDropdownMenuItem disabled>No tags yet</AppDropdownMenuItem>
      ) : (
        tags.map((item) => (
          <AppDropdownMenuItem
            key={item.tag}
            icon={item.tag === selected ? <Check aria-hidden /> : <span aria-hidden className="size-4" />}
            shortcut={formatNumber(item.count)}
            aria-label={`${item.tag}, ${item.count} ${item.count === 1 ? "contact" : "contacts"}`}
            onSelect={() => onSelect(item.tag === selected ? undefined : item.tag)}
          >
            {item.tag}
          </AppDropdownMenuItem>
        ))
      )}
    </AppDropdownMenu>
  );
}
