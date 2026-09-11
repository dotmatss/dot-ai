import type { ReactNode } from "react";

import { AppCard, AppCardContent, AppCardDescription, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { cn } from "@/lib/cn";

interface AnalyticsSectionProps {
  title: string;
  description?: ReactNode;
  /** Headline figure, badge or legend shown opposite the title. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * Card shell shared by every analytics section. `h-full` is deliberate: the
 * sections sit in a grid and a short card next to a tall one should still fill
 * its row rather than leaving a ragged edge.
 */
export function AnalyticsSection({
  title,
  description,
  aside,
  children,
  className,
  contentClassName,
}: AnalyticsSectionProps) {
  return (
    <AppCard className={cn("flex h-full flex-col", className)}>
      <AppCardHeader>
        <div className="min-w-0">
          <AppCardTitle>{title}</AppCardTitle>
          {description ? <AppCardDescription>{description}</AppCardDescription> : null}
        </div>
        {aside ? <div className="shrink-0 text-right">{aside}</div> : null}
      </AppCardHeader>
      <AppCardContent className={cn("flex flex-1 flex-col pt-4", contentClassName)}>{children}</AppCardContent>
    </AppCard>
  );
}
