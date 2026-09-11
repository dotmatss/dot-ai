import { AppListSkeleton } from "@/components/feedback/app-loading";
import { PageContainer } from "@/components/layout/page-container";
import { AppSkeleton } from "@/components/ui/app-skeleton";

export default function CrmLoading() {
  return (
    <PageContainer aria-busy="true">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <AppSkeleton className="h-8 w-32" />
          <AppSkeleton className="h-4 w-96" />
        </div>
        <AppSkeleton className="h-9 w-56" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AppSkeleton className="h-9 w-72" />
        <AppSkeleton className="h-8 w-80" />
      </div>
      <AppListSkeleton rows={6} />
    </PageContainer>
  );
}
