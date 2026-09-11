import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

export function AppSkeleton({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-border/70", className)} {...props} />;
}

export function AppSkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <AppSkeleton key={index} className={cn("h-3", index === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
