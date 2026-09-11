import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeSelector } from "@/components/layout/theme-selector";
import { __resetThemeCache } from "@/hooks/use-theme";
import { DARK_CLASS, THEME_STORAGE_KEY } from "@/lib/theme/theme";

/** Controllable `prefers-color-scheme`, which jsdom does not implement. */
function mockSystemPreference(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );
  return {
    /** Simulates the operating system switching appearance. */
    change(next: boolean) {
      query.matches = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  };
}

function isDark() {
  return document.documentElement.classList.contains(DARK_CLASS);
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove(DARK_CLASS);
  document.documentElement.style.colorScheme = "";
  __resetThemeCache();
  mockSystemPreference(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theme selector", () => {
  it("is a labelled radio group with the three appearances", () => {
    render(<ThemeSelector />);
    const group = screen.getByRole("group", { name: "Theme" });
    expect(group).toBeInTheDocument();
    for (const label of ["Light", "Dark", "System"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
  });

  it("starts on System when nothing has been chosen", () => {
    render(<ThemeSelector />);
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
  });

  it("applies the dark theme and remembers it", async () => {
    const user = userEvent.setup();
    render(<ThemeSelector />);

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    await waitFor(() => expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked());
    expect(isDark()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("applies the light theme even when the system prefers dark", async () => {
    mockSystemPreference(true);
    const user = userEvent.setup();
    render(<ThemeSelector />);

    await user.click(screen.getByRole("radio", { name: "Light" }));

    await waitFor(() => expect(screen.getByRole("radio", { name: "Light" })).toBeChecked());
    expect(isDark()).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("follows the operating system when System is chosen", async () => {
    mockSystemPreference(true);
    const user = userEvent.setup();
    render(<ThemeSelector />);

    // Move away first: a radio that is already checked fires no change event,
    // so selecting System from System would assert nothing.
    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(isDark()).toBe(false);

    await user.click(screen.getByRole("radio", { name: "System" }));

    await waitFor(() => expect(isDark()).toBe(true));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("reacts when the operating system changes while on System", async () => {
    const system = mockSystemPreference(false);
    const user = userEvent.setup();
    render(<ThemeSelector />);
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    await user.click(screen.getByRole("radio", { name: "System" }));
    expect(isDark()).toBe(false);

    system.change(true);

    await waitFor(() => expect(isDark()).toBe(true));
  });

  it("ignores the operating system once an explicit choice is made", async () => {
    const system = mockSystemPreference(false);
    const user = userEvent.setup();
    render(<ThemeSelector />);
    await user.click(screen.getByRole("radio", { name: "Light" }));

    system.change(true);

    // Still light: an explicit choice outranks the operating system.
    await waitFor(() => expect(screen.getByRole("radio", { name: "Light" })).toBeChecked());
    expect(isDark()).toBe(false);
  });

  it("restores a stored preference on a later visit", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    __resetThemeCache();
    render(<ThemeSelector />);

    await waitFor(() => expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked());
  });

  it("falls back to System when the stored value is nonsense", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "chartreuse");
    __resetThemeCache();
    render(<ThemeSelector />);

    await waitFor(() => expect(screen.getByRole("radio", { name: "System" })).toBeChecked());
  });

  it("is reachable and operable from the keyboard", async () => {
    const user = userEvent.setup();
    render(<ThemeSelector />);

    await user.tab();
    // A radio group is a single tab stop, landing on the checked option.
    expect(screen.getByRole("radio", { name: "System" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("radio", { name: "Light" })).toBeChecked());
    expect(isDark()).toBe(false);
  });

  it("communicates the selection without relying on colour", () => {
    render(<ThemeSelector />);
    // The choice is carried by the radio's checked state and by visible text,
    // both of which survive a monochrome or high-contrast display.
    const system = screen.getByRole("radio", { name: "System" });
    expect(system).toBeChecked();
    expect(screen.getByText("System")).toBeVisible();
  });

  it("still works when storage is unavailable", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();
    render(<ThemeSelector />);

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    // Applied for this page even though it could not be remembered.
    expect(isDark()).toBe(true);
    setItem.mockRestore();
  });
});
