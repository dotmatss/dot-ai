import { AppListSkeleton } from "@/components/feedback/app-loading";
import { PageContainer } from "@/components/layout/page-container";
import { AppSkeleton } from "@/components/ui/app-skeleton";

export default function WorkflowsLoading() {
  return (
    <PageContainer aria-busy="true">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <AppSkeleton className="h-8 w-44" />
          <AppSkeleton className="h-4 w-96" />
        </div>
        <AppSkeleton className="h-9 w-36" />
      </div>
      <AppSkeleton className="h-9 w-72" />
      <AppListSkeleton rows={5} />
    </PageContainer>
  );
}
