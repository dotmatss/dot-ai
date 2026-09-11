import { cn } from "@/lib/cn";

interface AppProgressBarProps {
  value: number;
  max?: number;
  label: string;
  showValue?: boolean;
  size?: "sm" | "md";
  className?: string;
  tone?: "default" | "success" | "warning" | "danger";
}

const BAR_TONE = {
  default: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

export function AppProgressBar({
  value,
  max = 100,
  label,
  showValue,
  size = "md",
  tone = "default",
  className,
}: AppProgressBarProps) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className={cn("w-full overflow-hidden rounded-full bg-border", size === "sm" ? "h-1.5" : "h-2")}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-300 ease-out-soft", BAR_TONE[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
      {showValue ? (
        <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-foreground-secondary">
          {Math.round(percent)}%
        </span>
      ) : null}
    </div>
  );
}

interface AppProgressCircleProps {
  value: number;
  max?: number;
  label: string;
  size?: number;
  strokeWidth?: number;
  showValue?: boolean;
  className?: string;
}

export function AppProgressCircle({
  value,
  max = 100,
  label,
  size = 56,
  strokeWidth = 5,
  showValue = true,
  className,
}: AppProgressCircleProps) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500 ease-out-soft"
        />
      </svg>
      {showValue ? (
        <span className="absolute text-xs font-semibold tabular-nums text-foreground">{Math.round(percent)}%</span>
      ) : null}
    </div>
  );
}
