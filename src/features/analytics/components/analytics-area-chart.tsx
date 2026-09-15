import { axisLabelAnchor, axisLabelIndices } from "@/components/charts/axis";
import { areaPath, axisTicks, chartPoints, polylinePoints, type ChartBox } from "@/features/analytics/chart-geometry";
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
  /** Height of the plot area in CSS pixels. Axis labels sit outside it. */
  height?: number;
  formatValue?: (value: number) => string;
  className?: string;
}

/**
 * Internal resolution for the path data. Only the horizontal axis is stretched
 * to fit the container, so this is not a pixel width.
 */
const PLOT_WIDTH = 640;
/** Inset inside the plot box so a 2px stroke at the axis top is not clipped. */
const INSET = 6;

/**
 * Hand-built line + area chart, monochrome, rendered on the server.
 *
 * All of the geometry comes from `chart-geometry`, so what is drawn is unit
 * tested rather than eyeballed. The plot is `role="img"` and describes itself
 * through the visually hidden table underneath: an SVG alone is not readable.
 *
 * Only the path data lives in the SVG. Axis labels are HTML beside and beneath
 * it, because a viewBox scales its contents: stretched across a full-width card
 * the old 11px labels rendered at more than 20px and a 220px plot came out
 * twice as tall. `preserveAspectRatio="none"` pins the vertical scale at 1:1 -
 * one viewBox unit is one pixel and `height` means what it says - while the
 * horizontal axis stretches to the container. The stroke is marked
 * non-scaling so the line stays an even 2px under that uneven scale.
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

  const box: ChartBox = { width: PLOT_WIDTH, height, padding: INSET };
  const ticks = axisTicks(top, 3);
  const tickPoints = chartPoints(ticks, box, top);
  const plotted = chartPoints(currentValues, box, top);
  // One bucket draws no line, so it is marked instead.
  const single = plotted.length === 1 ? plotted[0] : undefined;
  const labelled = new Set(axisLabelIndices(points.length));
  const percent = (x: number) => `${(x / PLOT_WIDTH) * 100}%`;

  return (
    <figure className={cn("w-full", className)}>
      <span id={`${id}-title`} className="sr-only">
        {title}
      </span>

      <div className="flex gap-2">
        <div aria-hidden className="relative w-9 shrink-0" style={{ height }}>
          {ticks.map((tick, index) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-caption tabular-nums text-foreground-muted"
              style={{ top: tickPoints[index]?.y ?? 0 }}
            >
              {formatCompactNumber(tick)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${PLOT_WIDTH} ${height}`}
            preserveAspectRatio="none"
            style={{ height }}
            className="block w-full"
            role="img"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-table`}
          >
            {ticks.map((tick, index) => (
              <line
                key={tick}
                x1={0}
                x2={PLOT_WIDTH}
                y1={tickPoints[index]?.y ?? 0}
                y2={tickPoints[index]?.y ?? 0}
                stroke="var(--color-border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                shapeRendering="crispEdges"
              />
            ))}
            {hasPrevious ? (
              <polyline
                points={polylinePoints(previousValues, box, top)}
                fill="none"
                stroke="var(--color-foreground-subtle)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
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
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* The marker gets its own un-stretched SVG: a circle inside the plot
              would be drawn as an ellipse by the horizontal scale. */}
          {single ? (
            <svg
              aria-hidden
              width={8}
              height={8}
              viewBox="0 0 8 8"
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: percent(single.x), top: single.y }}
            >
              <circle cx={4} cy={4} r={3.5} fill="var(--color-foreground)" />
            </svg>
          ) : null}

          <div aria-hidden className="relative mt-2 h-4">
            {points.map((point, index) =>
              labelled.has(index) ? (
                <span
                  key={point.key}
                  className={cn(
                    "absolute whitespace-nowrap text-caption text-foreground-muted",
                    axisLabelAnchor(index, points.length),
                  )}
                  style={{ left: percent(plotted[index]?.x ?? 0) }}
                >
                  {point.label}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>

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
