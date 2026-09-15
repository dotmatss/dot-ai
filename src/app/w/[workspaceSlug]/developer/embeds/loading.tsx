import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppSkeleton } from "@/components/ui/app-skeleton";

export default function EmbedsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <AppSkeleton className="h-5 w-24" />
        <AppSkeleton className="h-3 w-96" />
      </div>
      <AppListSkeleton rows={4} />
    </div>
  );
}
