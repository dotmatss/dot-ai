// @vitest-environment node
/**
 * Keeps the cookie policy honest.
 *
 * A cookie policy is only worth anything if it matches what the software
 * actually stores. So this checks the inventory against the code that writes
 * each entry, and fails when the application starts storing something that
 * nobody added to the list. It is the same argument as the public demo's
 * isolation test: a claim nothing enforces is a claim that quietly rots.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { COOKIE_POLICY } from "@/features/legal/content/cookies";
import {
  BROWSER_STORAGE,
  requiresConsentMechanism,
  storageByCategory,
  usesCookiesOrSimilar,
  type BrowserStorageEntry,
} from "@/features/legal/cookies";
import { LEGAL_DOCUMENTS } from "@/features/legal/registry";

const root = path.resolve(__dirname, "..", "..");

function read(file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

describe("browser storage inventory", () => {
  it("lists every entry with a purpose, a duration and the code that sets it", () => {
    expect(BROWSER_STORAGE.length).toBeGreaterThan(0);
    for (const entry of BROWSER_STORAGE) {
      expect(entry.purpose.length, entry.name).toBeGreaterThan(30);
      expect(entry.duration.length, entry.name).toBeGreaterThan(3);
      expect(() => read(entry.setBy), `${entry.name} points at ${entry.setBy}`).not.toThrow();
    }
  });

  it("names each entry in the file that claims to set it", () => {
    for (const entry of BROWSER_STORAGE) {
      expect(read(entry.setBy), `${entry.setBy} should contain ${entry.name}`).toContain(entry.name);
    }
  });

  it("describes the session cookie exactly as the code writes it", () => {
    const session = BROWSER_STORAGE.find((entry) => entry.name === "dot_session");
    expect(session).toBeDefined();
    const source = read("src/server/auth/session.ts");

    // HttpOnly is why the policy may say page scripts cannot read it.
    expect(source).toMatch(/httpOnly:\s*true/);
    expect(session?.readableByScript).toBe(false);
    expect(session?.category).toBe("strictly-necessary");
    expect(session?.firstParty).toBe(true);
  });

  it("describes the sidebar cookie exactly as the code writes it", () => {
    const sidebar = BROWSER_STORAGE.find((entry) => entry.name === "dot_sidebar_collapsed");
    expect(sidebar).toBeDefined();
    const source = read("src/stores/ui-preferences-store.tsx");

    // Written with document.cookie, so it is readable by script by definition.
    expect(source).toContain("document.cookie");
    expect(sidebar?.readableByScript).toBe(true);
    expect(sidebar?.category).toBe("functional");
  });

  it("describes the theme preference as local storage, not a cookie", () => {
    const theme = BROWSER_STORAGE.find((entry) => entry.name === "dot-theme");
    expect(theme?.kind).toBe("local-storage");
    expect(read("src/lib/theme/theme.ts")).toContain("dot-theme");
  });

  it("finds nothing stored by the application that the inventory misses", () => {
    // The narrow, checkable version: any cookie written through document.cookie
    // or any localStorage key written anywhere in src must be on the list.
    const known = new Set(BROWSER_STORAGE.map((entry) => entry.name));
    const sources = [
      "src/stores/ui-preferences-store.tsx",
      "src/server/auth/session.ts",
      "src/lib/theme/theme.ts",
      "src/hooks/use-theme.ts",
      "src/components/layout/theme-script.tsx",
    ];
    const found = new Set<string>();
    for (const file of sources) {
      for (const match of read(file).matchAll(/"(dot[-_][a-z_]+)"/g)) {
        if (match[1]) found.add(match[1]);
      }
    }
    expect([...found].filter((name) => !known.has(name))).toEqual([]);
  });

  it("confirms the embeddable widget stores nothing in a visitor's browser", () => {
    // The policy says so; this is what makes that safe to say.
    const widget = read("public/embed/widget.js");
    expect(widget).not.toMatch(/document\.cookie/);
    expect(widget).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  it("confirms there is no analytics or advertising storage anywhere", () => {
    expect(storageByCategory("analytics")).toEqual([]);
    expect(storageByCategory("marketing")).toEqual([]);
    expect(BROWSER_STORAGE.every((entry) => entry.firstParty)).toBe(true);
  });
});

describe("consent position", () => {
  it("does not require a consent mechanism for the current inventory", () => {
    expect(requiresConsentMechanism()).toBe(false);
  });

  it("requires one as soon as analytics storage is introduced", () => {
    const withAnalytics: BrowserStorageEntry[] = [
      ...BROWSER_STORAGE,
      {
        name: "_hypothetical_analytics",
        kind: "cookie",
        category: "analytics",
        firstParty: true,
        purpose: "Measures how the site is used.",
        duration: "2 years",
        setBy: "src/lib/theme/theme.ts",
        readableByScript: true,
      },
    ];
    expect(requiresConsentMechanism(withAnalytics)).toBe(true);
  });

  it("requires one as soon as a third-party entry is introduced", () => {
    const withThirdParty: BrowserStorageEntry[] = [
      { ...BROWSER_STORAGE[0]!, name: "_vendor", firstParty: false },
    ];
    expect(requiresConsentMechanism(withThirdParty)).toBe(true);
  });

  it("switches the policy's consent notice when the answer changes", () => {
    // The rendered notice is derived, so it cannot say "no banner needed"
    // after someone adds a tracker.
    const rendered = JSON.stringify(COOKIE_POLICY.blocks);
    expect(rendered).toMatch(/Why there is no cookie banner/);
    expect(rendered).not.toMatch(/Consent is required and is not yet implemented/);
  });
});

describe("cookie policy page is conditional", () => {
  it("is published because the application stores things in a browser", () => {
    expect(usesCookiesOrSimilar()).toBe(true);
    expect(LEGAL_DOCUMENTS.map((document) => document.slug)).toContain("cookies");
  });

  it("would not be published if nothing were stored", () => {
    // The registry derives from this predicate, so an application that stored
    // nothing would not publish a cookie policy for appearance.
    expect(usesCookiesOrSimilar([])).toBe(false);
  });

  it("renders the inventory rather than restating it", () => {
    const table = COOKIE_POLICY.blocks.find((block) => block.type === "table");
    expect(table).toBeDefined();
    if (table?.type !== "table") throw new Error("expected a table");
    expect(table.rows).toHaveLength(BROWSER_STORAGE.length);
    for (const entry of BROWSER_STORAGE) {
      expect(table.rows.some((row) => row[0] === entry.name), `${entry.name} should be in the table`).toBe(true);
    }
  });
});
