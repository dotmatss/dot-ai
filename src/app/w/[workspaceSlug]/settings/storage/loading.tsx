import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppSkeleton } from "@/components/ui/app-skeleton";

export default function StorageLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <AppSkeleton className="h-5 w-20" />
        <AppSkeleton className="h-28 rounded-lg" />
      </div>
      <div className="flex flex-col gap-3">
        <AppSkeleton className="h-5 w-32" />
        <AppListSkeleton rows={5} />
      </div>
    </div>
  );
}
