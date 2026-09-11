import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppSkeleton } from "@/components/ui/app-skeleton";

export default function MembersLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <AppSkeleton className="h-14 rounded-lg" />
      <AppListSkeleton rows={4} />
    </div>
  );
}
