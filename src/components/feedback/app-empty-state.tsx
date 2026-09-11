import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface AppEmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}

export function AppEmptyState({ icon, title, description, action, size = "md", className }: AppEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "sm" ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      {icon ? (
        <span
          className={cn(
            "flex items-center justify-center rounded-lg border border-border bg-surface text-foreground-muted shadow-xs",
            size === "sm" ? "size-9 [&_svg]:size-4" : "size-12 [&_svg]:size-5",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="max-w-sm">
        <p className={cn("font-semibold text-foreground", size === "sm" ? "text-sm" : "text-base")}>{title}</p>
        {description ? <p className="mt-1 text-sm text-foreground-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
