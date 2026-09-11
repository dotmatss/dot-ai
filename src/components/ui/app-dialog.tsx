"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";

import { AppButton } from "@/components/ui/app-button";
import { cn } from "@/lib/cn";

type DialogSize = "sm" | "md" | "lg" | "xl";

const SIZE: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export interface AppDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: DialogSize;
  /** Prevents closing via backdrop click / Escape (e.g. while submitting). */
  dismissible?: boolean;
  className?: string;
  /**
   * Fills the viewport: edge to edge on phones, a large centred panel from the
   * `sm` breakpoint up. For application-like surfaces (the public chat demo)
   * rather than ordinary forms. Overrides `size`.
   */
  fullScreen?: boolean;
  /**
   * With `fullScreen`, fills the entire viewport at every breakpoint instead
   * of settling into a centred panel on wide screens. Drive it from a control
   * in `headerActions` so the choice stays the viewer's.
   */
  expanded?: boolean;
  /** Controls placed before the close button, e.g. an expand toggle. */
  headerActions?: ReactNode;
  /** Replaces the default padding on the scrollable body. */
  contentClassName?: string;
  /** Replaces the default footer layout, which is built for form buttons. */
  footerClassName?: string;
}

/**
 * Modal dialog built on the native `<dialog>` element: focus trapping, the top
 * layer, Escape handling and focus restoration come from the platform.
 */
export function AppDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
  className,
  fullScreen = false,
  expanded = false,
  headerActions,
  contentClassName,
  footerClassName,
}: AppDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Exactly one of these is emitted. `cn` joins without resolving conflicts by
  // design, so overlaying a second width utility would be decided by the order
  // of the generated stylesheet rather than by this component.
  const surfaceClass = fullScreen
    ? expanded
      ? "h-dvh max-h-dvh w-screen max-w-none rounded-none border-0"
      : // Phones get a true full-screen surface with no rounding or border to
        // fake a window; wide screens get a large centred panel.
        "h-dvh max-h-dvh w-screen max-w-none rounded-none border-0 sm:h-[min(94dvh,60rem)] sm:w-[calc(100%-2rem)] sm:max-w-7xl sm:rounded-xl sm:border sm:border-border"
    : cn("w-[calc(100%-2rem)] rounded-xl border border-border", SIZE[size]);

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (!dismissible) return;
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={handleBackdropClick}
      className={cn(
        "m-auto bg-surface p-0 text-foreground shadow-lg",
        "open:animate-[dialog-in_180ms_var(--ease-out-soft)]",
        surfaceClass,
        className,
      )}
    >
      {open ? (
        <div className={cn("flex flex-col", fullScreen ? "h-full" : "max-h-[calc(100dvh-4rem)]")}>
          <header
            className={cn(
              "flex items-start justify-between gap-4",
              fullScreen ? "shrink-0 border-b border-border px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:py-4" : "px-6 pt-6",
            )}
          >
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold leading-6">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-sm text-foreground-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <div className="-mr-2 -mt-1 flex shrink-0 items-center gap-0.5">
              {headerActions}
              <AppButton variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close dialog">
                <X aria-hidden />
              </AppButton>
            </div>
          </header>
          {children ? (
            <div className={cn("min-h-0 flex-1 overflow-y-auto scrollbar-thin", contentClassName ?? "px-6 py-5")}>{children}</div>
          ) : (
            <div className="h-5" />
          )}
          {footer ? (
            <footer
              className={cn(
                "border-t border-border",
                footerClassName ??
                  cn(
                    "flex flex-col-reverse gap-2 px-6 py-4 sm:flex-row sm:justify-end",
                    fullScreen && "pb-[max(1rem,env(safe-area-inset-bottom))]",
                  ),
              )}
            >
              {footer}
            </footer>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

export interface AppConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}

export function AppConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  loading,
}: AppConfirmDialogProps) {
  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </AppButton>
          <AppButton variant={destructive ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </AppButton>
        </>
      }
    />
  );
}
