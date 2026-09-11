# Theming

One theme system for the whole application: the landing page, the documentation, the legal pages and the authenticated product all read the same preference. There is no separate marketing theme.

## The three settings

`Light`, `Dark` and `System`. `System` follows the operating system and keeps following it, so a laptop that switches at sunset switches the site too. An explicit choice outranks the operating system until it is changed back.

## How a theme is applied

The dark palette is a `.dark` class on `<html>`, defined in `src/app/globals.css`. It redefines **only the semantic tokens**:

- The ink scale (`--color-ink-50` through `--color-ink-950`) is a fixed palette. It does not change between themes. `bg-ink-900` is the same near-black in both.
- The semantic tokens flip: `background`, `surface*`, `border*`, `foreground*`, `accent*`, `ring`, every status tone, and the shadow scale.

That split is the whole design. A component that reaches for `bg-ink-900 text-white` is pinned to one appearance and will be unreadable in the other; a component that uses `bg-accent text-accent-foreground` is correct in both without knowing a theme exists. **Use semantic tokens.** The `dark:` variant should be unnecessary, and a use of it is a sign a token is missing.

`accent` and the `*-inverted` tokens deliberately invert: in a dark theme the high-contrast surface is light.

`color-scheme` is set alongside the class so the browser themes its own chrome, including scrollbars, form controls and the background painted during navigation.

## Persistence, and why it is not a cookie

The preference is stored in `localStorage` under `dot-theme`.

A cookie would let the server render the correct class directly. It would also have to be read in the root layout, which would make **every** public page dynamic and give up the static rendering of the landing page and the documentation. That cost is not worth paying for a preference, so the preference stays in the browser and the flash is solved a different way.

It is disclosed in the cookie policy as a similar technology, because it is one.

## Avoiding the flash

`src/components/layout/theme-script.tsx` renders a small blocking inline script in `<head>`. It reads the stored value and sets the class before the browser paints, so the page never appears in the wrong palette. It is written out longhand rather than importing helpers, because it runs before any bundle exists; the storage key and class name are interpolated from `src/lib/theme/theme.ts` so the two cannot drift.

Its `try`/`catch` is not padding: reading `localStorage` throws outright in a browser configured to block site data, and an unhandled exception there would leave the document unstyled.

## Avoiding the hydration mismatch

The server cannot know the preference, so it renders the default and the client adopts the stored value after mount.

`src/hooks/use-theme.ts` is a module-level external store read through `useSyncExternalStore`, not a context and not an effect that calls `setState`. The server snapshot is a frozen constant, identical for every request. All DOM writes happen inside the store, never in a component effect, which is also why the project's lint rule against synchronous `setState` in an effect is satisfied.

`<html>` carries `suppressHydrationWarning` because the boot script changes its `class` and `style` before React hydrates. That suppression is scoped to that one element and covers nothing inside `<body>`.

## The selector

`src/components/layout/theme-selector.tsx`, rendered in the shared footer.

It is a real radio group built on native `<input type="radio">` elements. Arrow-key navigation, the single tab stop, and announcements like "Dark, radio button, 2 of 3, selected" come from the platform rather than from bespoke keyboard handling. The inputs are visually hidden with `sr-only`, never `display: none`, so they stay focusable and announceable; the visible chip is a sibling styled with `peer-checked:`.

Selection is carried by the checked state and by visible text, not by colour alone.

## Exceptions

The embeddable chat widget (`src/features/embed/`) and its preview do **not** follow this theme. They render on a customer's own website in the chatbot's configured brand colour, and must not change appearance because the operator of this platform prefers dark mode. Their palette is fixed on purpose.

## Adding a themed component

1. Use semantic tokens. If you need a colour that has no token, add a token to both `:root` and `.dark` rather than hard-coding a value.
2. Check both themes, and check the pairing that usually fails: muted foreground on a muted surface, and status text on a status background.
3. For charts, bars, tracks and axis lines must use tokens or they vanish on a dark ground.
