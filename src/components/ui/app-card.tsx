import Link from "next/link";
import type { ComponentProps, ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

type CardVariant = "default" | "bordered" | "filled" | "interactive" | "muted";

const VARIANT: Record<CardVariant, string> = {
  default: "border border-border bg-surface shadow-xs",
  bordered: "border border-border bg-surface",
  muted: "border border-border bg-surface-muted",
  filled: "border border-transparent bg-surface-inverted text-foreground-inverted",
  interactive:
    "border border-border bg-surface shadow-xs transition-[box-shadow,transform,border-color] duration-200 ease-out-soft hover:-translate-y-px hover:border-border-strong hover:shadow-md",
};

type Padding = "none" | "sm" | "md" | "lg";

const PADDING: Record<Padding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export interface AppCardProps extends ComponentPropsWithoutRef<"div"> {
  variant?: CardVariant;
  padding?: Padding;
}

export function AppCard({ variant = "default", padding = "none", className, ...props }: AppCardProps) {
  return <div className={cn("rounded-lg", VARIANT[variant], PADDING[padding], className)} {...props} />;
}

type AppCardLinkProps = ComponentProps<typeof Link> & { padding?: Padding };

export function AppCardLink({ className, padding = "md", ...props }: AppCardLinkProps) {
  return (
    <Link
      className={cn("block rounded-lg focus-ring", VARIANT.interactive, PADDING[padding], className)}
      {...props}
    />
  );
}

export function AppCardHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("flex items-start justify-between gap-4 px-5 pt-5", className)} {...props} />;
}

export function AppCardTitle({ className, ...props }: ComponentPropsWithoutRef<"h3">) {
  return <h3 className={cn("text-base font-semibold leading-6", className)} {...props} />;
}

export function AppCardDescription({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return <p className={cn("mt-1 text-sm text-foreground-muted", className)} {...props} />;
}

export function AppCardContent({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("px-5 py-5", className)} {...props} />;
}

export function AppCardFooter({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("flex items-center justify-between gap-3 border-t border-border px-5 py-4", className)}
      {...props}
    />
  );
}
