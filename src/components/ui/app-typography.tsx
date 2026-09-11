import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import { cn } from "@/lib/cn";

type HeadingLevel = 1 | 2 | 3 | 4;

const HEADING_STYLES: Record<HeadingLevel, string> = {
  1: "text-3xl font-bold tracking-tight",
  2: "text-2xl font-semibold tracking-tight",
  3: "text-xl font-semibold tracking-tight",
  4: "text-base font-semibold",
};

interface AppHeadingProps extends ComponentPropsWithoutRef<"h1"> {
  level?: HeadingLevel;
  /** Render a different element while keeping the visual level. */
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "div";
}

export function AppHeading({ level = 2, as, className, ...props }: AppHeadingProps) {
  const Tag = (as ?? `h${level}`) as ElementType;
  return <Tag className={cn("text-foreground", HEADING_STYLES[level], className)} {...props} />;
}

type TextSize = "lg" | "md" | "sm" | "xs";
type TextTone = "default" | "secondary" | "muted" | "subtle" | "inverted" | "danger" | "success";
type TextWeight = "regular" | "medium" | "semibold";

const TEXT_SIZE: Record<TextSize, string> = {
  lg: "text-base",
  md: "text-sm",
  sm: "text-xs",
  xs: "text-caption",
};

const TEXT_TONE: Record<TextTone, string> = {
  default: "text-foreground",
  secondary: "text-foreground-secondary",
  muted: "text-foreground-muted",
  subtle: "text-foreground-subtle",
  inverted: "text-foreground-inverted",
  danger: "text-danger",
  success: "text-success",
};

const TEXT_WEIGHT: Record<TextWeight, string> = {
  regular: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
};

interface AppTextProps extends ComponentPropsWithoutRef<"p"> {
  size?: TextSize;
  tone?: TextTone;
  weight?: TextWeight;
  as?: "p" | "span" | "div" | "dd" | "dt" | "li" | "small";
  truncate?: boolean;
  children?: ReactNode;
}

export function AppText({
  size = "md",
  tone = "default",
  weight = "regular",
  as = "p",
  truncate,
  className,
  ...props
}: AppTextProps) {
  const Tag = as as ElementType;
  return (
    <Tag
      className={cn(TEXT_SIZE[size], TEXT_TONE[tone], TEXT_WEIGHT[weight], truncate && "truncate", className)}
      {...props}
    />
  );
}

export function AppDescription({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return <p className={cn("text-sm text-foreground-muted", className)} {...props} />;
}

export function AppCaption({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return <span className={cn("text-caption text-foreground-muted", className)} {...props} />;
}

export function AppOverline({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn("text-caption font-medium uppercase tracking-[0.08em] text-foreground-muted", className)}
      {...props}
    />
  );
}
