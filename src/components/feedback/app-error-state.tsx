import { CircleAlert, Lock, RefreshCw, SearchX, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

import { AppButton } from "@/components/ui/app-button";
import { isApiError } from "@/lib/api/api-error";
import { cn } from "@/lib/cn";

type ErrorKind = "error" | "not-found" | "forbidden" | "unauthorized" | "unavailable";

const KIND: Record<ErrorKind, { icon: ReactNode; title: string; description: string }> = {
  error: {
    icon: <CircleAlert aria-hidden />,
    title: "Something went wrong",
    description: "An unexpected error occurred. Try again, and contact support if the problem persists.",
  },
  "not-found": {
    icon: <SearchX aria-hidden />,
    title: "Not found",
    description: "The item you are looking for does not exist or may have been removed.",
  },
  forbidden: {
    icon: <ShieldAlert aria-hidden />,
    title: "Access denied",
    description: "You do not have permission to view this resource in this workspace.",
  },
  unauthorized: {
    icon: <Lock aria-hidden />,
    title: "Sign in required",
    description: "Your session has expired. Sign in again to continue.",
  },
  unavailable: {
    icon: <CircleAlert aria-hidden />,
    title: "Service unavailable",
    description: "The service is temporarily unavailable. Please try again shortly.",
  },
};

interface AppErrorStateProps {
  kind?: ErrorKind;
  error?: unknown;
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}

export function errorKindFrom(error: unknown): ErrorKind {
  if (isApiError(error)) {
    if (error.code === "not_found") return "not-found";
    if (error.code === "forbidden") return "forbidden";
    if (error.code === "unauthorized") return "unauthorized";
    if (error.code === "unavailable") return "unavailable";
  }
  return "error";
}

export function AppErrorState({
  kind,
  error,
  title,
  description,
  onRetry,
  retryLabel = "Try again",
  action,
  size = "md",
  className,
}: AppErrorStateProps) {
  const resolvedKind = kind ?? errorKindFrom(error);
  const preset = KIND[resolvedKind];
  const message = description ?? (isApiError(error) && resolvedKind === "error" ? error.message : preset.description);
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "sm" ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-lg border border-danger-border bg-danger-bg text-danger",
          size === "sm" ? "size-9 [&_svg]:size-4" : "size-12 [&_svg]:size-5",
        )}
      >
        {preset.icon}
      </span>
      <div className="max-w-sm">
        <p className={cn("font-semibold text-foreground", size === "sm" ? "text-sm" : "text-base")}>
          {title ?? preset.title}
        </p>
        <p className="mt-1 text-sm text-foreground-muted">{message}</p>
      </div>
      {onRetry || action ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <AppButton variant="secondary" size="sm" onClick={onRetry} leadingIcon={<RefreshCw aria-hidden />}>
              {retryLabel}
            </AppButton>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
