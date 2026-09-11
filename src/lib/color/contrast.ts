// The two inks this module can return. They are absolute on purpose: the input
// is an arbitrary customer brand colour, so the answer has to be computed
// against real black and real white rather than against a theme token that
// moves underneath it.
const INK = "#111111";
const WHITE = "#ffffff";

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance per WCAG 2.1, or null when the input is not a hex colour. */
export function relativeLuminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return null;
  const int = Number.parseInt(match[1], 16);
  const r = channel((int >> 16) & 0xff);
  const g = channel((int >> 8) & 0xff);
  const b = channel(int & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Picks white or ink for text sitting on `background`, whichever has the
 * stronger contrast.
 *
 * Customers choose their own brand colour for the widget, and a pale one (a
 * yellow, say) leaves hardcoded white text unreadable. Falls back to white for
 * an unparseable value so the widget still renders.
 */
export function readableTextColor(background: string): string {
  const withWhite = contrastRatio(background, WHITE);
  const withInk = contrastRatio(background, INK);
  if (withWhite === null || withInk === null) return WHITE;
  return withInk > withWhite ? INK : WHITE;
}
