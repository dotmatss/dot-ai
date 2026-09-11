"use client";

import { useId, useState } from "react";

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
  height?: number;
  className?: string;
  formatValue?: (value: number) => string;
}

const MAX_BAR_WIDTH = 24;

/**
 * Single-series column chart (optional comparison series in gray). Columns
 * are ≤24px, rounded at the data end and square at the baseline; hairline
 * gridlines; per-bar hover tooltip; table fallback for assistive tech.
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

  const width = 600;
  const padLeft = 36;
  const padRight = 8;
  const padTop = 12;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.compare ?? 0)));
  const niceMax = niceCeil(max);
  const ticks = [0, niceMax / 2, niceMax];
  const slot = plotW / Math.max(1, data.length);
  const hasCompare = data.some((d) => d.compare !== undefined);
  const barW = Math.min(MAX_BAR_WIDTH, slot * (hasCompare ? 0.32 : 0.55));
  const gap = 2;

  const y = (value: number) => padTop + plotH - (value / niceMax) * plotH;
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <figure className={cn("w-full", className)}>
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-table`}>
          <title id={`${id}-title`}>{title}</title>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={padLeft} x2={width - padRight} y1={y(tick)} y2={y(tick)} stroke="var(--color-border)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={padLeft - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" className="fill-foreground-muted text-[11px] tabular-nums">
                {formatCompactNumber(tick)}
              </text>
            </g>
          ))}
          {data.map((datum, index) => {
            const cx = padLeft + slot * index + slot / 2;
            const isActive = active === index;
            const barX = hasCompare ? cx - barW - gap / 2 : cx - barW / 2;
            const compareX = cx + gap / 2;
            const valueTop = y(datum.value);
            const compareTop = datum.compare !== undefined ? y(datum.compare) : null;
            return (
              <g
                key={datum.label}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                tabIndex={0}
                role="graphics-symbol"
                aria-label={`${datum.label}: ${formatValue(datum.value)}${datum.compare !== undefined ? `, ${compareLabel.toLowerCase()} ${formatValue(datum.compare)}` : ""}`}
                className="outline-none"
              >
                {/* Hit target spans the whole slot so small bars are easy to hover. */}
                <rect x={padLeft + slot * index} y={padTop} width={slot} height={plotH} fill="transparent" />
                {compareTop !== null ? (
                  <path d={roundedColumn(compareX, compareTop, barW, padTop + plotH - compareTop)} fill="var(--color-foreground-subtle)" opacity={isActive ? 1 : 0.9} />
                ) : null}
                <path d={roundedColumn(barX, valueTop, barW, padTop + plotH - valueTop)} fill="var(--color-foreground)" opacity={active === null || isActive ? 1 : 0.55} />
                {index % labelEvery === 0 || index === data.length - 1 ? (
                  <text x={cx} y={height - 8} textAnchor="middle" className="fill-foreground-muted text-[11px]">
                    {datum.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {active !== null && data[active] ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-surface-inverted px-2.5 py-1.5 text-xs text-foreground-inverted shadow-md"
            style={{
              left: `${((padLeft + slot * active + slot / 2) / width) * 100}%`,
              top: 0,
            }}
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

function roundedColumn(x: number, top: number, width: number, height: number): string {
  if (height <= 0) return "";
  const r = Math.min(4, width / 2, height);
  const bottom = top + height;
  return [
    `M${x} ${bottom}`,
    `V${top + r}`,
    `Q${x} ${top} ${x + r} ${top}`,
    `H${x + width - r}`,
    `Q${x + width} ${top} ${x + width} ${top + r}`,
    `V${bottom}`,
    "Z",
  ].join(" ");
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}
