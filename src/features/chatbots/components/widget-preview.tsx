import { MessageSquare, X } from "lucide-react";

import type { ChatbotAppearance } from "@/features/chatbots/types";
import { cn } from "@/lib/cn";
import { readableTextColor } from "@/lib/color/contrast";

interface WidgetPreviewProps {
  appearance: ChatbotAppearance;
  name: string;
  welcomeMessage: string;
  className?: string;
}

/** Static rendering of the embeddable widget used for appearance previews. */
export function WidgetPreview({ appearance, name, welcomeMessage, className }: WidgetPreviewProps) {
  const dark = appearance.theme === "dark";
  const onPrimary = readableTextColor(appearance.primaryColor);
  return (
    <div
      className={cn(
        "relative h-[460px] w-full overflow-hidden rounded-lg border border-border bg-[linear-gradient(135deg,var(--color-ink-100),var(--color-ink-50))]",
        className,
      )}
      aria-label="Widget preview"
      role="img"
    >
      <div
        className={cn(
          "absolute bottom-16 flex w-[300px] flex-col overflow-hidden rounded-xl border shadow-lg",
          appearance.position === "bottom-right" ? "right-4" : "left-4",
          dark ? "border-ink-700 bg-ink-900 text-white" : "border-border bg-white text-ink-900",
        )}
      >
        <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: appearance.primaryColor, color: onPrimary }}>
          {appearance.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- customer-provided asset host
            <img src={appearance.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
          ) : (
            <span className="flex size-8 items-center justify-center rounded-full bg-current/20 text-xs font-semibold">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{name}</span>
            <span className="block text-caption opacity-80">Typically replies instantly</span>
          </span>
          <X aria-hidden className="size-4 opacity-80" />
        </div>
        <div className={cn("flex h-56 flex-col gap-3 px-4 py-4 text-sm", dark ? "bg-ink-900" : "bg-ink-50")}>
          <div className={cn("max-w-[85%] rounded-lg rounded-tl-sm px-3 py-2", dark ? "bg-ink-800" : "bg-white shadow-xs")}>{welcomeMessage}</div>
          <div
            className="ml-auto max-w-[70%] rounded-lg rounded-tr-sm px-3 py-2"
            style={{ backgroundColor: appearance.primaryColor, color: onPrimary }}
          >
            Hi! Do you offer a free trial?
          </div>
        </div>
        <div className={cn("flex items-center gap-2 border-t px-3 py-2", dark ? "border-ink-700" : "border-border")}>
          <span className={cn("flex-1 rounded-md border px-3 py-1.5 text-xs", dark ? "border-ink-700 text-ink-400" : "border-border text-ink-400")}>
            Type a message…
          </span>
        </div>
        {appearance.showBranding ? (
          <div className={cn("py-1.5 text-center text-caption", dark ? "text-ink-500" : "text-ink-400")}>Powered by Dot</div>
        ) : null}
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className={cn(
          "absolute bottom-4 flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium shadow-lg",
          appearance.position === "bottom-right" ? "right-4" : "left-4",
        )}
        style={{ backgroundColor: appearance.primaryColor, color: onPrimary }}
      >
        <MessageSquare aria-hidden className="size-4" />
        {appearance.launcherLabel}
      </button>
    </div>
  );
}
