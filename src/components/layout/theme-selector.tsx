"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/cn";
import type { Theme } from "@/lib/theme/theme";

const OPTIONS: ReadonlyArray<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/**
 * Theme choice, as a real radio group.
 *
 * Native radios rather than styled buttons: arrow-key navigation, the single
 * tab stop, and "Dark, radio button, 2 of 3, selected" all come from the
 * platform. The inputs are visually hidden but never `display: none`, so they
 * stay focusable and announceable; the visible chip is their sibling.
 *
 * Selection is carried by the label text and by `checked`, not by colour
 * alone, so it survives high-contrast modes and monochrome displays.
 */
export function ThemeSelector({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const groupName = useId();

  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="text-caption font-medium uppercase tracking-caption text-foreground-muted">Theme</legend>
      <div className="mt-2 inline-flex rounded-lg border border-border bg-surface p-0.5 shadow-xs">
        {OPTIONS.map(({ value, label, Icon }) => (
          <label key={value} className="cursor-pointer">
            <input
              type="radio"
              name={groupName}
              value={value}
              checked={theme === value}
              onChange={() => setTheme(value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                "text-foreground-muted peer-hover:text-foreground",
                "peer-checked:bg-accent peer-checked:text-accent-foreground",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-ring)]",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
