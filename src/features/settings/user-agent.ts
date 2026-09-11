import { MAX_USER_AGENT_DISPLAY_LENGTH } from "@/features/settings/constants";

/**
 * User-agent normalisation for the session list.
 *
 * `sessions.user_agent` is whatever the client sent - up to 512 characters of
 * attacker-influenced text. Nothing here parses it for meaning beyond a label:
 * the goal is that a person recognises "that's my laptop", and that the raw
 * string is never rendered at full length.
 *
 * Order matters in both tables. Chromium-based browsers all claim `Chrome/`,
 * and iOS browsers all claim `Safari`, so the more specific token has to win;
 * likewise Android claims `Linux`, and iPhone/iPad claim `Mac OS X`.
 */

export interface DeviceDescription {
  browser: string | null;
  operatingSystem: string | null;
  /** "Chrome on macOS", "Safari", or "Unknown device" when nothing matched. */
  label: string;
}

const BROWSERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "Edge", pattern: /\bedg(?:e|a|ios)?\//i },
  { name: "Opera", pattern: /\bopr\/|\bopera\b/i },
  { name: "Samsung Internet", pattern: /\bsamsungbrowser\//i },
  { name: "Firefox", pattern: /\bfirefox\/|\bfxios\//i },
  { name: "Chrome", pattern: /\bchrome\/|\bcrios\//i },
  { name: "Safari", pattern: /\bsafari\//i },
];

const OPERATING_SYSTEMS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "Windows", pattern: /\bwindows nt\b/i },
  { name: "Android", pattern: /\bandroid\b/i },
  { name: "iPadOS", pattern: /\bipad\b/i },
  { name: "iOS", pattern: /\biphone\b|\bipod\b/i },
  { name: "macOS", pattern: /\bmac os x\b|\bmacintosh\b/i },
  { name: "Linux", pattern: /\blinux\b/i },
];

export const UNKNOWN_DEVICE_LABEL = "Unknown device";

export function describeUserAgent(userAgent: string | null | undefined): DeviceDescription {
  const value = userAgent?.trim() ?? "";
  if (!value) return { browser: null, operatingSystem: null, label: UNKNOWN_DEVICE_LABEL };

  const browser = BROWSERS.find((entry) => entry.pattern.test(value))?.name ?? null;
  const operatingSystem = OPERATING_SYSTEMS.find((entry) => entry.pattern.test(value))?.name ?? null;

  const label =
    browser && operatingSystem
      ? `${browser} on ${operatingSystem}`
      : (browser ?? operatingSystem ?? UNKNOWN_DEVICE_LABEL);

  return { browser, operatingSystem, label };
}

/**
 * Collapses whitespace and caps the length so one pathological header cannot
 * stretch a table row. Returns null for an absent or blank agent so the UI can
 * omit the line entirely rather than print an empty one.
 */
export function truncateUserAgent(
  userAgent: string | null | undefined,
  maxLength: number = MAX_USER_AGENT_DISPLAY_LENGTH,
): string | null {
  const value = userAgent?.replace(/\s+/g, " ").trim() ?? "";
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}
