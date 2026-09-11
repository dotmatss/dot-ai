/**
 * Geometry for the hand-built charts. No library, no DOM: these functions turn
 * a list of numbers into viewBox coordinates and percentages, which is why the
 * charts can render on the server and still be unit tested.
 */

export interface ChartBox {
  width: number;
  height: number;
  /** Inset on every side, in viewBox units, so strokes are not clipped. */
  padding?: number;
}

export interface ChartPoint {
  x: number;
  y: number;
}

/** Rounds to 2dp so the emitted path strings stay short and stable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Rounds a maximum up to a friendly axis top (1, 2, 5 × a power of ten), so
 * gridlines land on numbers a person would choose.
 */
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Evenly spaced gridline values from 0 to a nice maximum, ascending. */
export function axisTicks(max: number, count = 3): number[] {
  const top = niceCeil(max);
  const steps = Math.max(2, Math.floor(count));
  return Array.from({ length: steps }, (_, index) => round((top * index) / (steps - 1)));
}

function clamp(value: number, top: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, top);
}

/**
 * Maps values onto the box. `max` pins the vertical scale so two series drawn
 * over each other share one axis; omit it to scale to the values given.
 */
export function chartPoints(values: ReadonlyArray<number>, box: ChartBox, max?: number): ChartPoint[] {
  const padding = box.padding ?? 0;
  const innerWidth = Math.max(0, box.width - padding * 2);
  const innerHeight = Math.max(0, box.height - padding * 2);
  const top = niceCeil(max ?? values.reduce((highest, value) => (value > highest ? value : highest), 0));
  if (values.length === 0) return [];
  const y = (value: number) => round(padding + innerHeight - (clamp(value, top) / top) * innerHeight);
  if (values.length === 1) return [{ x: round(padding + innerWidth / 2), y: y(values[0] ?? 0) }];
  const step = innerWidth / (values.length - 1);
  return values.map((value, index) => ({ x: round(padding + index * step), y: y(value) }));
}

/** `points` attribute for an SVG polyline. */
export function polylinePoints(values: ReadonlyArray<number>, box: ChartBox, max?: number): string {
  return chartPoints(values, box, max)
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}

/** Closed path for the area wash under a line. Empty for fewer than two points. */
export function areaPath(values: ReadonlyArray<number>, box: ChartBox, max?: number): string {
  const points = chartPoints(values, box, max);
  if (points.length < 2) return "";
  const padding = box.padding ?? 0;
  const baseline = round(box.height - padding);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return "";
  const line = points.map((point) => `L${point.x} ${point.y}`).join(" ");
  return `M${first.x} ${baseline} ${line} L${last.x} ${baseline} Z`;
}

/**
 * Height of a CSS bar as a percentage of the tallest bar. A value of zero keeps
 * a hairline so an empty day is still visible as a baseline tick.
 */
export function barHeightPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const top = max > 0 ? max : 1;
  return round(Math.min(100, (value / top) * 100));
}
