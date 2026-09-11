/**
 * Theme contract, shared by the inline boot script, the provider and the tests.
 *
 * Kept free of React and of `server-only` on purpose: the same constants are
 * serialised into a `<script>` that runs before first paint, so they must be
 * expressible as plain values.
 */

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** What is actually painted once "system" has been resolved. */
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME: Theme = "system";

/**
 * Where the preference is stored.
 *
 * `localStorage`, not a cookie, and the choice matters. A cookie would have to
 * be read on the server to render the right class, which would make every
 * public page dynamic and give up the static rendering of the landing page and
 * the documentation. `localStorage` keeps them static, and the boot script
 * removes the flash that would otherwise cost.
 *
 * It is disclosed in the cookie policy as a similar technology, because it is
 * one, even though it is a preference the visitor set and nothing else.
 */
export const THEME_STORAGE_KEY = "dot-theme";

/** The class the dark token layer in `globals.css` hangs off. */
export const DARK_CLASS = "dark";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Narrows an unknown stored value to a theme, falling back to the default. */
export function parseTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

/** What "system" means right now. */
export function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === "system") return systemPrefersDark ? "dark" : "light";
  return theme;
}

/**
 * Applies a resolved theme to the document element.
 *
 * `colorScheme` is set alongside the class so the browser themes its own
 * chrome: scrollbars, form controls, and the default background behind the
 * page during navigation.
 */
export function applyTheme(root: HTMLElement, resolved: ResolvedTheme): void {
  root.classList.toggle(DARK_CLASS, resolved === "dark");
  root.style.colorScheme = resolved;
}

export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";
