import { ChevronDown } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

import { inputBaseClassName } from "@/components/ui/app-input";
import { cn } from "@/lib/cn";

export interface AppSelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface AppSelectProps extends Omit<ComponentPropsWithoutRef<"select">, "size"> {
  options: ReadonlyArray<AppSelectOption>;
  placeholder?: string;
  invalid?: boolean;
  size?: "sm" | "md";
}

/**
 * Native select styled to match inputs. Native semantics give free keyboard
 * and screen reader support; a custom listbox is only warranted when options
 * need rich content.
 */
export function AppSelect({ options, placeholder, invalid, size = "md", className, ...props }: AppSelectProps) {
  return (
    <div className="relative w-full">
      <select
        className={cn(
          inputBaseClassName,
          size === "sm" ? "h-8 pl-2.5 pr-8 text-xs" : "h-9 pl-3 pr-9",
          "appearance-none",
          className,
        )}
        aria-invalid={invalid || props["aria-invalid"] || undefined}
        {...props}
      >
        {placeholder ? (
          <option value="" disabled={props.required}>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-foreground-muted"
      />
    </div>
  );
}
