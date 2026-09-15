import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppSkeleton } from "@/components/ui/app-skeleton";

export default function CredentialsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <AppSkeleton className="h-5 w-28" />
          <AppSkeleton className="h-3 w-80" />
        </div>
        <AppSkeleton className="h-9 w-36" />
      </div>
      <AppListSkeleton rows={4} />
    </div>
  );
}
