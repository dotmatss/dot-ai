import { AppListSkeleton } from "@/components/feedback/app-loading";
import { PageContainer } from "@/components/layout/page-container";
import { AppSkeleton } from "@/components/ui/app-skeleton";

export default function ConversationsLoading() {
  return (
    <PageContainer aria-busy="true">
      <div className="flex flex-col gap-2">
        <AppSkeleton className="h-8 w-52" />
        <AppSkeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        <AppSkeleton className="h-9 w-full max-w-xs" />
        <AppSkeleton className="h-8 w-36" />
        <AppSkeleton className="h-8 w-36" />
        <AppSkeleton className="h-8 w-40" />
      </div>
      <AppListSkeleton rows={6} />
    </PageContainer>
  );
}
