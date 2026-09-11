"use client";

import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface AppSwitchProps extends Omit<ComponentPropsWithoutRef<"button">, "onChange" | "type" | "role"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  size?: "sm" | "md";
}

/**
 * Switch built on a button with role="switch".
 *
 * The visible text is wired up with aria-labelledby / aria-describedby rather
 * than relying on the wrapping <label for>: a label element does not contribute
 * an accessible name to a button, so a switch labelled only that way is
 * announced with no name at all. The htmlFor is kept so clicking the text still
 * toggles the control. Without a `label`, pass your own aria-label.
 */
export function AppSwitch({
  checked,
  onCheckedChange,
  label,
  description,
  size = "md",
  className,
  disabled,
  id,
  ...props
}: AppSwitchProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  const descriptionId = `${controlId}-description`;

  const control = (
    <button
      type="button"
      role="switch"
      id={controlId}
      aria-checked={checked}
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-150 focus-ring disabled:cursor-not-allowed",
        size === "sm" ? "h-5 w-9" : "h-6 w-11",
        checked ? "bg-accent" : "bg-border-strong",
        disabled && (checked ? "bg-border-strong" : "bg-border"),
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none inline-block rounded-full bg-surface shadow-sm transition-transform duration-150 ease-out-soft",
          size === "sm" ? "size-4" : "size-5",
          checked ? (size === "sm" ? "translate-x-4" : "translate-x-5") : "translate-x-0.5",
        )}
      />
    </button>
  );

  if (!label) return control;

  return (
    <div className="flex items-start justify-between gap-4">
      <label
        htmlFor={controlId}
        className={cn("flex flex-col gap-0.5 text-sm", disabled ? "text-foreground-subtle" : "text-foreground")}
      >
        <span id={labelId} className="font-medium leading-5">
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className="text-xs text-foreground-muted">
            {description}
          </span>
        ) : null}
      </label>
      {control}
    </div>
  );
}
