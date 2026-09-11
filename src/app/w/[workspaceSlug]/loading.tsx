import { PageContainer } from "@/components/layout/page-container";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppListSkeleton, AppStatGridSkeleton } from "@/components/feedback/app-loading";

export default function WorkspaceLoading() {
  return (
    <PageContainer aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-2">
        <AppSkeleton className="h-8 w-56" />
        <AppSkeleton className="h-4 w-80" />
      </div>
      <AppStatGridSkeleton />
      <AppListSkeleton rows={5} />
    </PageContainer>
  );
}
