import { AppSkeleton } from "@/components/ui/app-skeleton";

export default function ProfileLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-2">
          <AppSkeleton className="h-4 w-28" />
          <AppSkeleton className="h-3 w-60" />
        </div>
        <div className="flex flex-col gap-4">
          <AppSkeleton className="size-12 rounded-full" />
          <AppSkeleton className="h-9 w-full" />
          <AppSkeleton className="h-9 w-full" />
          <AppSkeleton className="ml-auto h-9 w-32" />
        </div>
      </div>
      <AppSkeleton className="h-28 rounded-lg" />
    </div>
  );
}
