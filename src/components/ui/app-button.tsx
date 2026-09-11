import Link from "next/link";
import type { ComponentProps, ComponentPropsWithoutRef, ReactNode } from "react";

import { AppSpinner } from "@/components/ui/app-spinner";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-lg";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow] duration-150 ease-out-soft focus-ring disabled:pointer-events-none select-none";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-foreground shadow-xs hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-muted disabled:text-foreground-subtle disabled:shadow-none",
  secondary:
    "border border-border bg-surface text-foreground shadow-xs hover:bg-surface-hover hover:border-border-strong active:bg-surface-muted disabled:bg-surface disabled:text-foreground-subtle disabled:border-border disabled:shadow-none",
  ghost:
    "text-foreground-secondary hover:bg-surface-muted hover:text-foreground active:bg-border disabled:text-foreground-subtle",
  danger:
    "bg-danger text-accent-foreground shadow-xs hover:bg-danger/90 active:bg-danger/80 disabled:bg-surface-muted disabled:text-foreground-subtle disabled:shadow-none",
  link: "h-auto rounded-none p-0 text-foreground underline-offset-4 hover:underline disabled:text-foreground-subtle",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-5 text-sm",
  icon: "h-9 w-9 p-0",
  "icon-sm": "h-8 w-8 p-0",
  "icon-lg": "h-10 w-10 p-0",
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: "[&_svg]:size-3.5",
  md: "[&_svg]:size-4",
  lg: "[&_svg]:size-4",
  icon: "[&_svg]:size-4",
  "icon-sm": "[&_svg]:size-4",
  "icon-lg": "[&_svg]:size-5",
};

export function buttonClassName(options: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}) {
  const { variant = "primary", size = "md", fullWidth, className } = options;
  return cn(
    BASE,
    VARIANT[variant],
    variant === "link" ? "text-sm" : SIZE[size],
    ICON_SIZE[size],
    fullWidth && "w-full",
    className,
  );
}

export interface AppButtonProps extends ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function AppButton({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth,
  leadingIcon,
  trailingIcon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: AppButtonProps) {
  const isIconOnly = size.startsWith("icon");
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, fullWidth, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <AppSpinner size="sm" className="shrink-0" /> : leadingIcon}
      {isIconOnly && loading ? null : children}
      {!loading && trailingIcon}
    </button>
  );
}

type AppButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
};

export function AppButtonLink({
  variant = "primary",
  size = "md",
  fullWidth,
  leadingIcon,
  trailingIcon,
  className,
  children,
  ...props
}: AppButtonLinkProps) {
  return (
    <Link className={buttonClassName({ variant, size, fullWidth, className })} {...props}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </Link>
  );
}
