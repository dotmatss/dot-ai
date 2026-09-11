export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return `${value.toFixed(fractionDigits)}%`;
}

export function formatSignedPercent(value: number, fractionDigits = 0): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(fractionDigits)}%`;
}
