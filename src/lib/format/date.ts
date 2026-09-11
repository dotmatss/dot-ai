const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

export function formatRelativeTime(input: string | Date, now: Date = new Date()): string {
  const date = typeof input === "string" ? new Date(input) : input;
  let duration = (date.getTime() - now.getTime()) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return relativeFormatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return relativeFormatter.format(Math.round(duration), "year");
}

export function formatDate(input: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(date);
}

export function formatDateTime(input: string | Date): string {
  return formatDate(input, { hour: "numeric", minute: "2-digit" });
}

export function formatTime(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date);
}
