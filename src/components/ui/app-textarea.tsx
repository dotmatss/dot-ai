import type { ComponentPropsWithoutRef } from "react";

import { inputBaseClassName } from "@/components/ui/app-input";
import { cn } from "@/lib/cn";

export interface AppTextareaProps extends ComponentPropsWithoutRef<"textarea"> {
  invalid?: boolean;
  resize?: "none" | "vertical";
}

export function AppTextarea({ invalid, resize = "vertical", className, rows = 4, ...props }: AppTextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(
        inputBaseClassName,
        "min-h-20 px-3 py-2 leading-5",
        resize === "none" ? "resize-none" : "resize-y",
        className,
      )}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      {...props}
    />
  );
}
