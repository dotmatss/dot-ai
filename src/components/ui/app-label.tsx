import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

interface AppLabelProps extends ComponentPropsWithoutRef<"label"> {
  required?: boolean;
  optional?: boolean;
}

export function AppLabel({ required, optional, className, children, ...props }: AppLabelProps) {
  return (
    <label className={cn("inline-flex items-center gap-1 text-sm font-medium text-foreground", className)} {...props}>
      {children}
      {required ? (
        <span aria-hidden className="text-danger">
          *
        </span>
      ) : null}
      {optional ? <span className="font-normal text-foreground-muted">(optional)</span> : null}
    </label>
  );
}

export function AppHelpText({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return <p className={cn("text-xs text-foreground-muted", className)} {...props} />;
}

export function AppFieldError({ className, children, ...props }: ComponentPropsWithoutRef<"p">) {
  if (!children) return null;
  return (
    <p role="alert" className={cn("text-xs font-medium text-danger", className)} {...props}>
      {children}
    </p>
  );
}
