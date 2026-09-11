import { Check, Minus } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface AppCheckboxProps extends Omit<ComponentPropsWithoutRef<"input">, "type" | "size"> {
  label?: ReactNode;
  description?: ReactNode;
  indeterminate?: boolean;
}

/**
 * Native checkbox with a custom box. The real input stays in the DOM (visually
 * hidden but focusable) so forms, labels and assistive tech behave natively.
 */
export function AppCheckbox({ label, description, indeterminate, className, id, disabled, ...props }: AppCheckboxProps) {
  const control = (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        id={id}
        disabled={disabled}
        className="peer absolute inset-0 size-4 cursor-pointer appearance-none rounded-xs border border-border-strong bg-surface transition-colors checked:border-accent checked:bg-accent hover:border-foreground-muted focus-ring disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:checked:bg-border-strong disabled:checked:border-border-strong aria-[checked=mixed]:border-accent aria-[checked=mixed]:bg-accent"
        aria-checked={indeterminate ? "mixed" : undefined}
        {...props}
      />
      <span className="pointer-events-none relative hidden text-accent-foreground peer-checked:block peer-aria-[checked=mixed]:block">
        {indeterminate ? <Minus className="size-3" strokeWidth={3} aria-hidden /> : <Check className="size-3" strokeWidth={3} aria-hidden />}
      </span>
    </span>
  );

  if (!label) return <span className={cn("inline-flex", className)}>{control}</span>;

  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-start gap-2.5 text-sm",
        disabled ? "cursor-not-allowed text-foreground-subtle" : "cursor-pointer text-foreground",
        className,
      )}
    >
      <span className="mt-0.5">{control}</span>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium leading-5">{label}</span>
        {description ? <span className="text-xs text-foreground-muted">{description}</span> : null}
      </span>
    </label>
  );
}
