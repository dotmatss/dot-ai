import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppSpinner } from "@/components/ui/app-spinner";
import { cn } from "@/lib/cn";

interface AppLoadingProps {
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

/** Centered spinner with an accessible live-region label. */
export function AppLoading({ label = "Loading", size = "md", className }: AppLoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-foreground-muted",
        size === "sm" ? "py-8" : "py-16",
        className,
      )}
    >
      <AppSpinner size={size === "sm" ? "md" : "lg"} label={label} />
      <span className="text-xs">{label}</span>
    </div>
  );
}

/** Skeleton for list / table pages. */
export function AppListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <div className="flex h-10 items-center gap-4 border-b border-border bg-surface-muted/60 px-4">
        <AppSkeleton className="h-3 w-32" />
        <AppSkeleton className="h-3 w-20" />
        <AppSkeleton className="ml-auto h-3 w-16" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
          <AppSkeleton className="size-8 rounded-md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <AppSkeleton className="h-3 w-48" />
            <AppSkeleton className="h-2.5 w-24" />
          </div>
          <AppSkeleton className="h-5 w-16 rounded-full" />
          <AppSkeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton for a grid of stat cards. */
export function AppStatGridSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <AppSkeleton className="h-3 w-24" />
          <AppSkeleton className="h-8 w-20" />
          <AppSkeleton className="h-2.5 w-32" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton for a detail page with header and content blocks. */
export function AppDetailSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-6", className)}>
      <div className="flex items-center gap-4">
        <AppSkeleton className="size-12 rounded-lg" />
        <div className="flex flex-col gap-2">
          <AppSkeleton className="h-5 w-56" />
          <AppSkeleton className="h-3 w-32" />
        </div>
      </div>
      <AppSkeleton className="h-10 w-full max-w-lg" />
      <div className="grid gap-4 lg:grid-cols-3">
        <AppSkeleton className="h-48 lg:col-span-2" />
        <AppSkeleton className="h-48" />
      </div>
    </div>
  );
}
