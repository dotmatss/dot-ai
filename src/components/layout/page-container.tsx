import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

type Width = "default" | "narrow" | "wide" | "full";

const WIDTH: Record<Width, string> = {
  default: "max-w-7xl",
  narrow: "max-w-3xl",
  wide: "max-w-[96rem]",
  full: "max-w-none",
};

interface PageContainerProps extends ComponentPropsWithoutRef<"div"> {
  width?: Width;
}

export function PageContainer({ width = "default", className, ...props }: PageContainerProps) {
  return (
    <div
      className={cn("mx-auto flex w-full flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8", WIDTH[width], className)}
      {...props}
    />
  );
}
