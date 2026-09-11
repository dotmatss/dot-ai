import { ChevronRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

interface AppListProps extends ComponentPropsWithoutRef<"ul"> {
  divided?: boolean;
  bordered?: boolean;
}

export function AppList({ divided = true, bordered = true, className, ...props }: AppListProps) {
  return (
    <ul
      className={cn(
        "overflow-hidden bg-surface",
        bordered && "rounded-lg border border-border shadow-xs",
        divided && "divide-y divide-border",
        className,
      )}
      {...props}
    />
  );
}

interface AppListItemProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  href?: Route;
  onClick?: () => void;
  className?: string;
}

const ROW = "flex w-full items-center gap-3 px-4 py-3 text-left text-sm";
const INTERACTIVE = "transition-colors hover:bg-surface-hover focus-ring focus-visible:-outline-offset-2";

export function AppListItem({ title, description, icon, leading, trailing, href, onClick, className }: AppListItemProps) {
  const content = (
    <>
      {leading}
      {icon ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{title}</span>
        {description ? <span className="block truncate text-xs text-foreground-muted">{description}</span> : null}
      </span>
      {trailing ?? (href || onClick ? <ChevronRight aria-hidden className="size-4 shrink-0 text-foreground-subtle" /> : null)}
    </>
  );

  if (href) {
    return (
      <li className={className}>
        <Link href={href} className={cn(ROW, INTERACTIVE)}>
          {content}
        </Link>
      </li>
    );
  }
  if (onClick) {
    return (
      <li className={className}>
        <button type="button" onClick={onClick} className={cn(ROW, INTERACTIVE)}>
          {content}
        </button>
      </li>
    );
  }
  return <li className={cn(ROW, className)}>{content}</li>;
}
