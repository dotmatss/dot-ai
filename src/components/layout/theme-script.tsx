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

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
