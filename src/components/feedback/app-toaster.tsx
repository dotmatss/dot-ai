"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useEffect } from "react";

import { cn } from "@/lib/cn";
import { useToastStore, type ToastItem, type ToastTone } from "@/stores/toast-store";

const ICON: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CircleCheck, className: "text-success" },
  info: { icon: Info, className: "text-info" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  danger: { icon: CircleAlert, className: "text-danger" },
};

function Toast({ toast }: { toast: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const { icon: Icon, className } = ICON[toast.tone];

  useEffect(() => {
    if (toast.duration === null) return;
    const timer = window.setTimeout(() => dismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.duration, dismiss]);

  return (
    <div
      role={toast.tone === "danger" || toast.tone === "warning" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-lg",
        "animate-[toast-in_200ms_var(--ease-out-soft)]",
      )}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", className)} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-foreground">{toast.title}</p>
        {toast.description ? <p className="mt-0.5 text-foreground-muted">{toast.description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-mr-1 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm text-foreground-muted hover:bg-surface-muted hover:text-foreground focus-ring"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export function AppToaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-60 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
