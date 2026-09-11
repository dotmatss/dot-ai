"use client";

import { Eye, EyeOff, Search, X } from "lucide-react";
import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export const inputBaseClassName =
  "block w-full rounded-md border border-border bg-surface text-sm text-foreground shadow-xs transition-[border-color,box-shadow] duration-150 placeholder:text-foreground-subtle hover:border-border-strong focus:border-foreground focus:outline-none focus:ring-2 focus:ring-ring/10 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-foreground-subtle disabled:shadow-none aria-invalid:border-danger aria-invalid:focus:ring-danger/15 read-only:bg-surface-muted";

type InputSize = "sm" | "md" | "lg";

const INPUT_SIZE: Record<InputSize, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3",
  lg: "h-10 px-3.5",
};

export interface AppInputProps extends Omit<ComponentPropsWithoutRef<"input">, "size"> {
  size?: InputSize;
  leadingIcon?: ReactNode;
  trailingSlot?: ReactNode;
  invalid?: boolean;
}

export function AppInput({
  size = "md",
  leadingIcon,
  trailingSlot,
  invalid,
  className,
  ...props
}: AppInputProps) {
  const hasAdornment = Boolean(leadingIcon || trailingSlot);
  const input = (
    <input
      className={cn(
        inputBaseClassName,
        INPUT_SIZE[size],
        leadingIcon && "pl-9",
        trailingSlot && "pr-10",
        className,
      )}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      {...props}
    />
  );

  if (!hasAdornment) return input;

  return (
    <div className="relative w-full">
      {leadingIcon ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex w-9 items-center justify-center text-foreground-muted [&_svg]:size-4">
          {leadingIcon}
        </span>
      ) : null}
      {input}
      {trailingSlot ? (
        <span className="absolute inset-y-0 right-0 flex items-center pr-1.5 text-foreground-muted [&_svg]:size-4">
          {trailingSlot}
        </span>
      ) : null}
    </div>
  );
}

export function AppPasswordInput(props: Omit<AppInputProps, "type" | "trailingSlot">) {
  const [visible, setVisible] = useState(false);
  return (
    <AppInput
      type={visible ? "text" : "password"}
      autoComplete={props.autoComplete ?? "current-password"}
      trailingSlot={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="flex size-7 items-center justify-center rounded-sm text-foreground-muted hover:text-foreground focus-ring"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          tabIndex={-1}
        >
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </button>
      }
      {...props}
    />
  );
}

interface AppSearchInputProps extends Omit<AppInputProps, "leadingIcon" | "type" | "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
  onClear?: () => void;
}

export function AppSearchInput({ value, onValueChange, onClear, placeholder = "Search…", ...props }: AppSearchInputProps) {
  return (
    <AppInput
      type="search"
      role="searchbox"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      placeholder={placeholder}
      leadingIcon={<Search aria-hidden />}
      trailingSlot={
        value ? (
          <button
            type="button"
            onClick={() => {
              onValueChange("");
              onClear?.();
            }}
            className="flex size-7 items-center justify-center rounded-sm text-foreground-muted hover:text-foreground focus-ring"
            aria-label="Clear search"
          >
            <X aria-hidden />
          </button>
        ) : null
      }
      className="[&::-webkit-search-cancel-button]:hidden"
      {...props}
    />
  );
}
