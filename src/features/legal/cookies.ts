/**
 * What this application actually stores in a browser.
 *
 * This is an inventory, not prose. Every entry was verified against the code
 * that writes it, and the cookie policy is rendered from this list rather than
 * describing it separately, so the page cannot drift from the implementation.
 *
 * If you add anything that writes to a browser - an analytics script, a
 * session replay tool, an advertising pixel, an A/B testing SDK - add it here
 * in the same commit. `tests/unit/legal-cookies.test.ts` fails when the code
 * and this list disagree about the two first-party cookies.
 */

export type StorageKind = "cookie" | "local-storage";

/**
 * Consent categories as they are normally understood under the ePrivacy rules.
 *
 * `strictly-necessary` is exempt from consent. `functional` is a preference
 * the user themselves set; whether it needs consent depends on jurisdiction
 * and on how it is set, which is one of the questions flagged for review.
 */
export type ConsentCategory = "strictly-necessary" | "functional" | "analytics" | "marketing";

export interface BrowserStorageEntry {
  name: string;
  kind: StorageKind;
  category: ConsentCategory;
  /** First party means set by this application on its own domain. */
  firstParty: boolean;
  purpose: string;
  duration: string;
  /** Where in the codebase it is written. Keeps the inventory checkable. */
  setBy: string;
  /** Whether page script can read it. HttpOnly cookies cannot be. */
  readableByScript: boolean;
}

export const BROWSER_STORAGE: ReadonlyArray<BrowserStorageEntry> = [
  {
    name: "dot_session",
    kind: "cookie",
    category: "strictly-necessary",
    firstParty: true,
    purpose:
      "Keeps you signed in. It holds an opaque random token; the session itself lives in our database, and the token is stored there only as a hash.",
    duration: "Up to 90 days, or until you sign out",
    setBy: "src/server/auth/session.ts",
    readableByScript: false,
  },
  {
    name: "dot_sidebar_collapsed",
    kind: "cookie",
    category: "functional",
    firstParty: true,
    purpose:
      "Remembers whether you collapsed the navigation sidebar, so the page renders the way you left it instead of shifting after load. Set only inside the signed-in application.",
    duration: "1 year",
    setBy: "src/stores/ui-preferences-store.tsx",
    readableByScript: true,
  },
  {
    name: "dot-theme",
    kind: "local-storage",
    category: "functional",
    firstParty: true,
    purpose:
      "Remembers whether you chose the light, dark or system appearance. It is read before the page paints so the site does not flash the wrong theme.",
    duration: "Until you clear your browser storage",
    setBy: "src/lib/theme/theme.ts",
    readableByScript: true,
  },
];

/** Whether a cookie policy is warranted at all. */
export function usesCookiesOrSimilar(entries: ReadonlyArray<BrowserStorageEntry> = BROWSER_STORAGE): boolean {
  return entries.length > 0;
}

/**
 * Whether a consent mechanism appears to be required.
 *
 * Strictly necessary storage is exempt. A functional preference that the user
 * set themselves, is first party, and is not used to build a profile is
 * normally treated the same way. Anything in the analytics or marketing
 * categories changes the answer, which is the point of deriving this rather
 * than hard-coding "no banner needed" somewhere.
 *
 * This is an engineering signal for the team, not a legal conclusion. See the
 * review notes in `src/features/legal/review-notes.ts`.
 */
export function requiresConsentMechanism(entries: ReadonlyArray<BrowserStorageEntry> = BROWSER_STORAGE): boolean {
  return entries.some((entry) => entry.category === "analytics" || entry.category === "marketing" || !entry.firstParty);
}

export function storageByCategory(category: ConsentCategory): BrowserStorageEntry[] {
  return BROWSER_STORAGE.filter((entry) => entry.category === category);
}

export const CATEGORY_LABELS: Record<ConsentCategory, string> = {
  "strictly-necessary": "Strictly necessary",
  functional: "Functional",
  analytics: "Analytics",
  marketing: "Marketing",
};

export const KIND_LABELS: Record<StorageKind, string> = {
  cookie: "Cookie",
  "local-storage": "Local storage",
};
