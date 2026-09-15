import { AppListSkeleton, AppStatGridSkeleton } from "@/components/feedback/app-loading";
import { PageContainer } from "@/components/layout/page-container";
import { AppSkeleton } from "@/components/ui/app-skeleton";

export default function IntelligenceLoading() {
  return (
    <PageContainer aria-busy="true">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <AppSkeleton className="h-8 w-40" />
          <AppSkeleton className="h-4 w-[28rem]" />
        </div>
        <AppSkeleton className="h-9 w-64" />
      </div>
      <AppStatGridSkeleton />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AppSkeleton className="h-9 w-72" />
        <AppSkeleton className="h-8 w-80" />
      </div>
      <AppListSkeleton rows={6} />
    </PageContainer>
  );
}
