import { cn } from "@/lib/cn";

type SpinnerSize = "xs" | "sm" | "md" | "lg";

const SIZE: Record<SpinnerSize, string> = {
  xs: "size-3",
  sm: "size-4",
  md: "size-6",
  lg: "size-8",
};

interface AppSpinnerProps {
  size?: SpinnerSize;
  className?: string;
  label?: string;
}

/** Dotted ring spinner matching the reference design. */
export function AppSpinner({ size = "md", className, label = "Loading" }: AppSpinnerProps) {
  return (
    <svg
      className={cn("animate-spin text-current [animation-duration:1.1s]", SIZE[size], className)}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={label}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeDasharray="2.2 4.2"
        opacity="0.9"
      />
    </svg>
  );
}
