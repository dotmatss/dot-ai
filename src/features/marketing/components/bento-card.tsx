import { ArrowUpRight, type LucideIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface BentoCardProps {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Fills both rows of the grid, so it sits alongside a stacked pair. */
  tall?: boolean;
  href?: string;
  /** Optional illustration rendered beneath the copy. */
  children?: ReactNode;
  className?: string;
}

/**
 * One tile of the bento grid.
 *
 * Renders as a link when it has a destination and as a plain article otherwise,
 * so a keyboard user never lands on a tile that does nothing. Entirely server
 * rendered: the hover treatment is CSS.
 */
export function BentoCard({ eyebrow, title, description, icon: Icon, tall, href, children, className }: BentoCardProps) {
  const content = (
    <>
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
          <Icon aria-hidden className="size-4" />
        </span>
        <span className="text-caption font-medium uppercase tracking-caption text-foreground-muted">{eyebrow}</span>
      </div>

      <div className="mt-5 flex-1">
        <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground">{title}</h3>
        <p className="mt-2 max-w-prose text-sm leading-6 text-foreground-secondary">{description}</p>
      </div>

      {children ? <div className="mt-6">{children}</div> : null}

      {href ? (
        <span className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-foreground">
          Read the docs
          <ArrowUpRight aria-hidden className="size-4 transition-transform duration-200 ease-out-soft group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </span>
      ) : null}
    </>
  );

  const shell = cn(
    "group flex flex-col rounded-xl border border-border bg-surface p-6 shadow-xs transition-[box-shadow,border-color,transform] duration-200 ease-out-soft",
    href && "hover:-translate-y-px hover:border-border-strong hover:shadow-md focus-ring",
    tall && "md:row-span-2",
    className,
  );

  if (href) {
    return (
      <Link href={href as Route} className={shell}>
        {content}
      </Link>
    );
  }

  return <article className={shell}>{content}</article>;
}
