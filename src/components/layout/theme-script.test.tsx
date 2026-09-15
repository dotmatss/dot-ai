import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeScript } from "@/components/layout/theme-script";
import { __resetThemeCache } from "@/hooks/use-theme";
import { DARK_CLASS, THEME_STORAGE_KEY } from "@/lib/theme/theme";

/** Controllable `prefers-color-scheme`, which jsdom does not implement. */
function mockSystemPreference(prefersDark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: prefersDark,
      media: "(prefers-color-scheme: dark)",
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

function root() {
  return document.documentElement;
}

beforeEach(() => {
  window.localStorage.clear();
  root().classList.remove(DARK_CLASS);
  root().style.colorScheme = "";
  __resetThemeCache();
  mockSystemPreference(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theme script", () => {
  it("is inert once React renders it in the browser", () => {
    // React executes no script it creates itself, and says so on the console
    // unless the type marks the tag as a data block. The server copy - the one
    // that actually runs during parsing - keeps its executable type.
    const { container } = render(<ThemeScript />);
    expect(container.querySelector("script")).toHaveAttribute("type", "text/plain");
  });

  it("restores a dark theme React has overwritten", () => {
    // Standing in for the rebuild: the stored choice is dark, but <html> is
    // carrying the class list from the root layout's JSX.
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    render(<ThemeScript />);

    expect(root().classList.contains(DARK_CLASS)).toBe(true);
    expect(root().style.colorScheme).toBe("dark");
  });

  it("restores a system theme by asking the operating system again", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    mockSystemPreference(true);

    render(<ThemeScript />);

    expect(root().classList.contains(DARK_CLASS)).toBe(true);
    expect(root().style.colorScheme).toBe("dark");
  });

  it("leaves a light document alone", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    root().classList.add(DARK_CLASS);

    render(<ThemeScript />);

    expect(root().classList.contains(DARK_CLASS)).toBe(false);
    expect(root().style.colorScheme).toBe("light");
  });
});
