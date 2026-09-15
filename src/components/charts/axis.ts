/**
 * Which buckets carry an axis label.
 *
 * Ninety daily buckets cannot each show a date, so labels are thinned to at
 * most `maxLabels`, evenly spaced, always keeping the first and the last.
 *
 * This returns indices rather than a step because of that last label. Stepping
 * by n and then adding the final bucket collides whenever the count is not a
 * clean multiple: 30 buckets stepped by 4 put a label on 28 and another on 29,
 * which is how "Sep 12" ended up printed on top of "Sep 13". A label closer to
 * the end than half a step is dropped in favour of the end.
 */
export function axisLabelIndices(count: number, maxLabels = 8): number[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  if (count === 1) return [0];
  const last = count - 1;
  const step = Math.max(1, Math.ceil(count / Math.max(1, maxLabels)));
  const indices: number[] = [];
  for (let index = 0; index < last; index += step) indices.push(index);
  while (indices.length > 0 && last - indices[indices.length - 1]! < step / 2) indices.pop();
  indices.push(last);
  return indices;
}

/**
 * Horizontal anchoring for an axis label, so the first and last do not hang off
 * the ends of the plot. Everything between is centred on its bucket.
 */
export function axisLabelAnchor(index: number, count: number): string {
  if (index === 0) return "translate-x-0";
  if (index === count - 1) return "-translate-x-full";
  return "-translate-x-1/2";
}
