import { AppCard, AppCardContent, AppCardHeader } from "@/components/ui/app-card";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { cn } from "@/lib/cn";

/**
 * Fallback for one streamed section. Each section awaits its own aggregate, so
 * a slow query shows a card-shaped placeholder in place rather than holding the
 * whole page back.
 */
export function AnalyticsCardSkeleton({ bodyClassName = "h-48", className }: { bodyClassName?: string; className?: string }) {
  return (
    <AppCard aria-busy="true" className={cn("flex h-full flex-col", className)}>
      <AppCardHeader>
        <div className="flex w-full flex-col gap-2">
          <AppSkeleton className="h-4 w-40" />
          <AppSkeleton className="h-3 w-64" />
        </div>
      </AppCardHeader>
      <AppCardContent className="flex-1 pt-4">
        <AppSkeleton className={cn("w-full", bodyClassName)} />
      </AppCardContent>
    </AppCard>
  );
}
