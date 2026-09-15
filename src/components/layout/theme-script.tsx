"use client";

import { useLayoutEffect } from "react";

import { syncDocumentTheme } from "@/hooks/use-theme";
import { DARK_CLASS, THEME_MEDIA_QUERY, THEME_STORAGE_KEY } from "@/lib/theme/theme";

/**
 * Applies the stored theme before the browser paints.
 *
 * This has to be a blocking inline script, and it has to be early in <head>.
 * Any later and the page paints in the light palette first, then flips - the
 * flash of the wrong theme that every client-side-only implementation has.
 *
 * It is written out longhand rather than importing the helpers because it runs
 * before any bundle has loaded. The storage key and class name are interpolated
 * from the shared module so the two cannot drift apart.
 *
 * The try/catch is not defensive padding: reading `localStorage` throws
 * outright in a browser configured to block site data, and an exception here
 * would leave the document unstyled.
 */
const script = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var d=t==="dark"||((!t||t==="system")&&window.matchMedia(${JSON.stringify(THEME_MEDIA_QUERY)}).matches);var e=document.documentElement;e.classList.toggle(${JSON.stringify(DARK_CLASS)},d);e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;

/**
 * The type attribute is deliberately different on each side of the render.
 *
 * On the server it is a real script, which is the entire point: the browser
 * runs it while parsing <head>, ahead of first paint.
 *
 * The client is a different matter. Whenever React builds this tree instead of
 * hydrating it - a hydration mismatch anywhere without a nearer boundary
 * regenerates everything from the root, <head> included - it creates the
 * element itself, and a script React creates never runs. It says so, once, as a
 * console error. Giving the client copy a type the HTML spec calls a data block
 * states that the inertness is intended and settles the complaint;
 * `suppressHydrationWarning` covers the difference between the two types, which
 * is by design rather than drift.
 *
 * This is why the component is a Client Component: a server one would serialise
 * the server's type into the payload and React would re-create the executable
 * form in the browser, warning all the same.
 *
 * See node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md.
 */
export function ThemeScript() {
  // The same job as the script, for the case the script cannot cover: when
  // React rebuilds this tree rather than hydrating it, it restores the class
  // list <html> has in JSX, dropping the one the script set, and a script React
  // creates itself never runs to set it again. A layout effect lands after that
  // commit and before the paint. On an ordinary load it is a no-op that writes
  // the values already there.
  useLayoutEffect(() => {
    syncDocumentTheme();
  }, []);

  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
