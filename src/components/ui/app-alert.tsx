import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

type AlertTone = "info" | "success" | "warning" | "danger" | "neutral";

const TONE: Record<AlertTone, { wrapper: string; icon: ReactNode }> = {
  neutral: { wrapper: "border-border bg-surface-muted text-foreground", icon: <Info aria-hidden /> },
  info: { wrapper: "border-info-border bg-info-bg text-foreground", icon: <Info aria-hidden className="text-info" /> },
  success: {
    wrapper: "border-success-border bg-success-bg text-foreground",
    icon: <CircleCheck aria-hidden className="text-success" />,
  },
  warning: {
    wrapper: "border-warning-border bg-warning-bg text-foreground",
    icon: <TriangleAlert aria-hidden className="text-warning" />,
  },
  danger: {
    wrapper: "border-danger-border bg-danger-bg text-foreground",
    icon: <CircleAlert aria-hidden className="text-danger" />,
  },
};

interface AppAlertProps extends Omit<ComponentPropsWithoutRef<"div">, "title"> {
  tone?: AlertTone;
  title?: ReactNode;
  action?: ReactNode;
}

export function AppAlert({ tone = "neutral", title, action, className, children, ...props }: AppAlertProps) {
  const role = tone === "danger" || tone === "warning" ? "alert" : "status";
  return (
    <div
      role={role}
      className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", TONE[tone].wrapper, className)}
      {...props}
    >
      <span className="mt-0.5 shrink-0 [&_svg]:size-4">{TONE[tone].icon}</span>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn("text-foreground-secondary", title && "mt-0.5")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
