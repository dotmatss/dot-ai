import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppSkeleton } from "@/components/ui/app-skeleton";

export default function AuditLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <AppSkeleton className="h-9 w-full max-w-md rounded-md" />
      <AppListSkeleton rows={8} />
    </div>
  );
}
