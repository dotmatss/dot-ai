import { AppSkeleton } from "@/components/ui/app-skeleton";

export default function IntegrationsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div className="flex gap-2">
        <AppSkeleton className="h-8 w-16 rounded-full" />
        <AppSkeleton className="h-8 w-24 rounded-full" />
        <AppSkeleton className="h-8 w-24 rounded-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <AppSkeleton key={index} className="h-56 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
