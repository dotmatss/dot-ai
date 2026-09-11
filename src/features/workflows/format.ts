/** Human duration for run and step timings. */
export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

/** Stable, readable JSON for step output panels. */
export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}
