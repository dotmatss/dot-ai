import { cn } from "@/lib/cn";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground", className)}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="3" fill="currentColor" />
      </svg>
    </span>
  );
}
