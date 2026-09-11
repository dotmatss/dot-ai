import { AppStatGridSkeleton } from "@/components/feedback/app-loading";
import { AnalyticsCardSkeleton } from "@/features/analytics/components/analytics-skeletons";

export default function AnalyticsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <AppStatGridSkeleton />
      <div className="grid gap-6 xl:grid-cols-3">
        <AnalyticsCardSkeleton bodyClassName="h-56" className="xl:col-span-2" />
        <AnalyticsCardSkeleton bodyClassName="h-56" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <AnalyticsCardSkeleton bodyClassName="h-56" />
        <AnalyticsCardSkeleton bodyClassName="h-32" />
      </div>
      <AnalyticsCardSkeleton bodyClassName="h-72" />
      <div className="grid gap-6 lg:grid-cols-2">
        <AnalyticsCardSkeleton bodyClassName="h-32" />
        <AnalyticsCardSkeleton bodyClassName="h-64" />
      </div>
    </div>
  );
}
