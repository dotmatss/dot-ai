"use client";

import { useId, useState } from "react";

import { axisLabelAnchor, axisLabelIndices } from "@/components/charts/axis";
import { cn } from "@/lib/cn";
import { formatCompactNumber, formatNumber } from "@/lib/format/number";

export interface BarDatum {
  label: string;
  value: number;
  /** Optional comparison value drawn in the de-emphasis tone. */
  compare?: number;
}

interface AppBarChartProps {
  data: BarDatum[];
  /** Accessible title, also used for the table caption. */
  title: string;
  valueLabel?: string;
  compareLabel?: string;
  /** Height of the plot area in CSS pixels. Axis labels sit outside it. */
  height?: number;
  className?: string;
  formatValue?: (value: number) => string;
}

/**
 * Single-series column chart (optional comparison series in gray). Columns are
 * at most 24px, rounded at the data end and square at the baseline; hairline
 * gridlines; per-bar hover tooltip; table fallback for assistive tech.
 *
 * Drawn in HTML rather than SVG, on purpose. The previous version put the bars
 * and the axis labels in a viewBox, where every unit is multiplied by (rendered
 * width / 600). In a full-width card that factor is well over two, so an 11px
 * label rendered at more than 24px, the plot came out twice the height it asked
 * for, and the 24px column cap meant nothing. Percentage heights stretch
 * horizontally and leave type, radii and column widths in real pixels.
 */
export function AppBarChart({
  data,
  title,
  valueLabel = "Value",
  compareLabel = "Previous",
  height = 200,
  className,
  formatValue = formatNumber,
}: AppBarChartProps) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(1, ...data.map((datum) => Math.max(datum.value, datum.compare ?? 0)));
  const niceMax = niceCeil(max);
  const ticks = [0, niceMax / 2, niceMax];
  const hasCompare = data.some((datum) => datum.compare !== undefined);
  const labelled = new Set(axisLabelIndices(data.length));
  const slots = Math.max(1, data.length);
  const barHeight = (value: number) => `${Math.max(0, Math.min(100, (value / niceMax) * 100))}%`;
  const slotCentre = (index: number) => `${((index + 0.5) / slots) * 100}%`;

  return (
    <figure className={cn("w-full", className)}>
      <span id={`${id}-title`} className="sr-only">
        {title}
      </span>

      <div className="flex gap-2">
        <div aria-hidden className="relative w-9 shrink-0" style={{ height }}>
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-caption tabular-nums text-foreground-muted"
              style={{ top: `${100 - (tick / niceMax) * 100}%` }}
            >
              {formatCompactNumber(tick)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <div aria-hidden className="absolute inset-0">
            {ticks.map((tick) => (
              <div
                key={tick}
                className="absolute inset-x-0 h-px -translate-y-1/2 bg-border"
                style={{ top: `${100 - (tick / niceMax) * 100}%` }}
              />
            ))}
          </div>

          <div
            role="img"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-table`}
            className="relative flex items-end"
            style={{ height }}
          >
            {data.map((datum, index) => {
              const isActive = active === index;
              return (
                <div
                  key={datum.label}
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  tabIndex={0}
                  role="graphics-symbol"
                  aria-label={`${datum.label}: ${formatValue(datum.value)}${datum.compare !== undefined ? `, ${compareLabel.toLowerCase()} ${formatValue(datum.compare)}` : ""}`}
                  className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5 px-0.5 outline-none"
                >
                  {datum.compare !== undefined ? (
                    <span
                      aria-hidden
                      className={cn(
                        "min-h-px w-full max-w-3 rounded-t-xs bg-foreground-subtle",
                        isActive ? "opacity-100" : "opacity-90",
                      )}
                      style={{ height: barHeight(datum.compare) }}
                    />
                  ) : null}
                  <span
                    aria-hidden
                    className={cn(
                      "min-h-px w-full rounded-t-xs bg-foreground",
                      hasCompare ? "max-w-3" : "max-w-6",
                      active === null || isActive ? "opacity-100" : "opacity-55",
                    )}
                    style={{ height: barHeight(datum.value) }}
                  />
                </div>
              );
            })}
          </div>

          {active !== null && data[active] ? (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md bg-surface-inverted px-2.5 py-1.5 text-xs text-foreground-inverted shadow-md"
              style={{ left: slotCentre(active) }}
            >
              <p className="font-medium">{data[active].label}</p>
              <p className="tabular-nums">
                {valueLabel}: {formatValue(data[active].value)}
              </p>
              {data[active].compare !== undefined ? (
                <p className="tabular-nums text-foreground-inverted/70">
                  {compareLabel}: {formatValue(data[active].compare)}
                </p>
              ) : null}
            </div>
          ) : null}

          <div aria-hidden className="relative mt-2 h-4">
            {data.map((datum, index) =>
              labelled.has(index) ? (
                <span
                  key={datum.label}
                  className={cn(
                    "absolute whitespace-nowrap text-caption text-foreground-muted",
                    axisLabelAnchor(index, data.length),
                  )}
                  style={{ left: slotCentre(index) }}
                >
                  {datum.label}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>

      {hasCompare ? (
        <figcaption className="mt-2 flex items-center gap-4 text-xs text-foreground-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rounded-xs bg-foreground" />
            {valueLabel}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rounded-xs bg-foreground-subtle" />
            {compareLabel}
          </span>
        </figcaption>
      ) : null}

      <table id={`${id}-table`} className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Label</th>
            <th scope="col">{valueLabel}</th>
            {hasCompare ? <th scope="col">{compareLabel}</th> : null}
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.label}>
              <th scope="row">{datum.label}</th>
              <td>{formatValue(datum.value)}</td>
              {hasCompare ? <td>{datum.compare !== undefined ? formatValue(datum.compare) : "—"}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}
