import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppFooter } from "@/components/layout/app-footer";
import { LEGAL_DOCUMENTS } from "@/features/legal/registry";

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
});

function legalNav() {
  return screen.getByRole("navigation", { name: "Legal" });
}

describe("application footer", () => {
  it("links to every registered legal document", () => {
    render(<AppFooter />);
    const nav = legalNav();

    for (const document of LEGAL_DOCUMENTS) {
      const label = document.slug === "cookies" ? "Cookies" : document.slug === "privacy" ? "Privacy" : "Terms";
      const link = screen.getByRole("link", { name: label });
      expect(nav).toContainElement(link);
      expect(link).toHaveAttribute("href", `/${document.slug}`);
    }
  });

  it("shows the cookie link only because a cookie policy is published", () => {
    render(<AppFooter />);
    const published = LEGAL_DOCUMENTS.some((document) => document.slug === "cookies");
    const link = screen.queryByRole("link", { name: "Cookies" });

    // The link and the page are driven by the same registry, so they cannot
    // disagree: a link to a page that 404s is the failure this prevents.
    expect(Boolean(link)).toBe(published);
  });

  it("links to the documentation from the legal row", () => {
    render(<AppFooter />);
    const link = screen.getAllByRole("link", { name: "Documentation" }).at(-1);
    expect(link).toHaveAttribute("href", "/docs");
    expect(legalNav()).toContainElement(link!);
  });

  it("keeps the product and developer navigation", () => {
    render(<AppFooter />);
    expect(screen.getByRole("navigation", { name: "Product" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Developers" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Platform" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chat API" })).toHaveAttribute("href", "/docs/api/chat");
  });

  it("carries the theme selector", () => {
    render(<AppFooter />);
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeInTheDocument();
  });

  it("names every link, so the footer is navigable by screen reader", () => {
    render(<AppFooter />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.textContent?.trim().length, link.getAttribute("href") ?? "").toBeGreaterThan(0);
      expect(link).toHaveAttribute("href");
    }
  });
});
