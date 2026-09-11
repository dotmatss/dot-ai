import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface AppRadioProps extends Omit<ComponentPropsWithoutRef<"input">, "type" | "size"> {
  label?: ReactNode;
  description?: ReactNode;
}

export function AppRadio({ label, description, className, id, disabled, ...props }: AppRadioProps) {
  const control = (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      <input
        type="radio"
        id={id}
        disabled={disabled}
        className="peer absolute inset-0 size-4 cursor-pointer appearance-none rounded-full border border-border-strong bg-surface transition-colors checked:border-accent hover:border-foreground-muted focus-ring disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted"
        {...props}
      />
      <span className="pointer-events-none relative hidden size-2 rounded-full bg-accent peer-checked:block peer-disabled:bg-border-strong" />
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

interface AppRadioGroupProps extends ComponentPropsWithoutRef<"fieldset"> {
  legend: ReactNode;
  legendHidden?: boolean;
}

export function AppRadioGroup({ legend, legendHidden, className, children, ...props }: AppRadioGroupProps) {
  return (
    <fieldset className={cn("flex flex-col gap-3", className)} {...props}>
      <legend className={cn("mb-2 text-sm font-medium text-foreground", legendHidden && "sr-only")}>{legend}</legend>
      {children}
    </fieldset>
  );
}
