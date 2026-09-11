import { areaPath, axisTicks, chartPoints, polylinePoints, type ChartBox } from "@/features/analytics/chart-geometry";
import { axisLabelEvery } from "@/features/analytics/series";
import { cn } from "@/lib/cn";
import { formatCompactNumber, formatNumber } from "@/lib/format/number";

export interface AnalyticsChartPoint {
  /** Stable key - the bucket start. */
  key: string;
  /** Short axis label, e.g. "Mar 4". */
  label: string;
  /** Full bucket span, read by the table equivalent. */
  rangeLabel: string;
  current: number;
  /** Omit for a single-series chart. */
  previous?: number;
  /** Span of the matching bucket one period earlier, when there is one. */
  previousRangeLabel?: string | null;
}

interface AnalyticsAreaChartProps {
  /** Unique within the page: ids are built from it, and Server Components have no useId. */
  id: string;
  title: string;
  points: AnalyticsChartPoint[];
  currentLabel: string;
  previousLabel?: string;
  /** Shared axis top so both series are drawn to one scale. */
  max?: number;
  height?: number;
  formatValue?: (value: number) => string;
  className?: string;
}

const WIDTH = 640;
const PAD_LEFT = 40;
const PAD_RIGHT = 8;
const PAD_BOTTOM = 24;
/** Inset inside the plot box so a 2px stroke at the axis top is not clipped. */
const INSET = 6;

/**
 * Hand-built line + area chart, monochrome, rendered on the server.
 *
 * All of the geometry comes from `chart-geometry`, so what is drawn is unit
 * tested rather than eyeballed. The SVG is `role="img"` and describes itself
 * through the visually hidden table underneath: an SVG alone is not readable.
 */
export function AnalyticsAreaChart({
  id,
  title,
  points,
  currentLabel,
  previousLabel = "Previous period",
  max,
  height = 220,
  formatValue = formatNumber,
  className,
}: AnalyticsAreaChartProps) {
  const currentValues = points.map((point) => point.current);
  const hasPrevious = points.some((point) => point.previous !== undefined);
  const previousValues = points.map((point) => point.previous ?? 0);
  const top = Math.max(max ?? 0, ...currentValues, ...(hasPrevious ? previousValues : []), 0);

  const box: ChartBox = { width: WIDTH - PAD_LEFT - PAD_RIGHT, height: height - PAD_BOTTOM, padding: INSET };
  const ticks = axisTicks(top, 3);
  const tickPoints = chartPoints(ticks, box, top);
  const plotted = chartPoints(currentValues, box, top);
  // One bucket draws no line, so it is marked instead.
  const single = plotted.length === 1 ? plotted[0] : undefined;
  const labelEvery = axisLabelEvery(points.length);

  return (
    <figure className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-table`}
      >
        <title id={`${id}-title`}>{title}</title>
        {ticks.map((tick, index) => {
          const y = tickPoints[index]?.y ?? 0;
          return (
            <g key={tick}>
              <line
                x1={PAD_LEFT}
                x2={WIDTH - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke="var(--color-border)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={PAD_LEFT - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-foreground-muted text-[11px] tabular-nums"
              >
                {formatCompactNumber(tick)}
              </text>
            </g>
          );
        })}
        <g transform={`translate(${PAD_LEFT} 0)`}>
          {hasPrevious ? (
            <polyline
              points={polylinePoints(previousValues, box, top)}
              fill="none"
              stroke="var(--color-foreground-subtle)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
          <path d={areaPath(currentValues, box, top)} fill="var(--color-foreground)" opacity={0.08} />
          <polyline
            points={polylinePoints(currentValues, box, top)}
            fill="none"
            stroke="var(--color-foreground)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {single ? <circle cx={single.x} cy={single.y} r={3.5} fill="var(--color-foreground)" /> : null}
        </g>
        {points.map((point, index) => {
          const last = index === points.length - 1;
          if (index % labelEvery !== 0 && !last) return null;
          return (
            <text
              key={point.key}
              x={PAD_LEFT + (plotted[index]?.x ?? 0)}
              y={height - 6}
              textAnchor={index === 0 ? "start" : last ? "end" : "middle"}
              className="fill-foreground-muted text-[11px]"
            >
              {point.label}
            </text>
          );
        })}
      </svg>

      <figcaption className="mt-2 flex flex-wrap items-center gap-4 text-xs text-foreground-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 rounded-full bg-foreground" />
          {currentLabel}
        </span>
        {hasPrevious ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-4 rounded-full bg-foreground-subtle" />
            {previousLabel}
          </span>
        ) : null}
      </figcaption>

      <table id={`${id}-table`} className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Bucket</th>
            <th scope="col">{currentLabel}</th>
            {hasPrevious ? <th scope="col">{previousLabel}</th> : null}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <th scope="row">{point.rangeLabel}</th>
              <td>{formatValue(point.current)}</td>
              {hasPrevious ? (
                <td>
                  {formatValue(point.previous ?? 0)}
                  {point.previousRangeLabel ? ` (${point.previousRangeLabel})` : ""}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
