import { cn } from "@/lib/cn";

interface AppSparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Accessible summary, e.g. "Messages per day over the last 14 days". */
  label: string;
  className?: string;
}

/**
 * 12–30 point trend line for stat tiles: 2px line, ~10% area wash and an
 * end marker with a surface ring. Single series, so no legend is needed.
 */
export function AppSparkline({ values, width = 120, height = 36, label, className }: AppSparklineProps) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const padX = 4;
  const padY = 5;
  const stepX = (width - padX * 2) / (values.length - 1);
  const points = values.map((value, index) => ({
    x: padX + index * stepX,
    y: padY + (1 - (value - min) / range) * (height - padY * 2),
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;
  const area = `${path} L${last.x.toFixed(1)} ${height - padY} L${padX} ${height - padY} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`${label}. Latest value ${values[values.length - 1]}, high ${max}, low ${Math.min(...values)}.`}
      className={cn("overflow-visible text-foreground", className)}
    >
      <path d={area} fill="currentColor" opacity={0.08} />
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r={5} fill="var(--color-surface)" />
      <circle cx={last.x} cy={last.y} r={3.5} fill="currentColor" />
    </svg>
  );
}
