import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppSkeleton } from "@/components/ui/app-skeleton";

export default function SecurityLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <AppSkeleton className="h-8 w-full max-w-2xl" />
      <div className="flex justify-end gap-2">
        <AppSkeleton className="h-8 w-44" />
        <AppSkeleton className="h-8 w-40" />
      </div>
      <AppListSkeleton rows={3} />
    </div>
  );
}
