import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PlanComparison } from "@/features/pricing/components/plan-comparison";
import { PricingGrid } from "@/features/pricing/components/pricing-grid";
import { ENTITLEMENT_GROUPS, ENTITLEMENT_LABELS, PLANS } from "@/features/pricing/plans";

/** The card for one plan, found by its heading. */
function cardFor(name: string): HTMLElement {
  const card = screen.getByRole("heading", { name }).closest("article");
  if (!card) throw new Error(`No card found for the "${name}" plan`);
  return card as HTMLElement;
}

describe("pricing grid", () => {
  it("renders every plan with its name, description and call to action", () => {
    render(<PricingGrid />);

    for (const plan of PLANS) {
      const card = cardFor(plan.name);
      expect(card).toBeTruthy();
      expect(within(card).getByRole("heading", { name: plan.name })).toBeInTheDocument();
      expect(within(card).getByText(plan.description)).toBeInTheDocument();
      expect(within(card).getByRole("link", { name: plan.cta.label })).toHaveAttribute("href", plan.cta.href);
    }
  });

  it("starts on monthly billing", () => {
    render(<PricingGrid />);
    expect(screen.getByRole("radio", { name: "Monthly" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Yearly" })).not.toBeChecked();
  });

  it("switches the displayed interval", async () => {
    const user = userEvent.setup();
    render(<PricingGrid />);

    await user.click(screen.getByRole("radio", { name: "Yearly" }));

    expect(screen.getByRole("radio", { name: "Yearly" })).toBeChecked();
    // The undecided plans state the interval alongside the placeholder, so the
    // switch is observable even before any price exists.
    expect(screen.getAllByText("per year").length).toBeGreaterThan(0);
    expect(screen.queryByText("per month")).not.toBeInTheDocument();
  });

  it("is operable from the keyboard", async () => {
    const user = userEvent.setup();
    render(<PricingGrid />);

    await user.tab();
    expect(screen.getByRole("radio", { name: "Monthly" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Yearly" })).toBeChecked();
  });

  it("marks an undecided price as undecided rather than showing a number", () => {
    render(<PricingGrid />);
    const undecided = PLANS.filter((plan) => plan.price.monthly.kind === "undecided");
    expect(undecided.length).toBeGreaterThan(0);

    for (const plan of undecided) {
      const card = cardFor(plan.name);
      expect(within(card).getByText("Price to be confirmed")).toBeInTheDocument();
    }
  });

  it("shows no currency amount anywhere, because none has been decided", () => {
    const { container } = render(<PricingGrid />);
    expect(container.textContent ?? "").not.toMatch(/[$£€]\s?\d/);
    expect(container.textContent ?? "").not.toMatch(/\d+\s?(USD|EUR|GBP)/);
  });

  it("highlights at most one plan", () => {
    render(<PricingGrid />);
    expect(screen.getAllByText("Most complete")).toHaveLength(1);
  });

  it("renders the cards as a labelled list, so the count is announced", () => {
    render(<PricingGrid />);
    const list = screen.getByRole("list", { name: "Plans" });
    expect(within(list).getAllByRole("listitem", { hidden: false }).length).toBeGreaterThanOrEqual(PLANS.length);
  });
});

describe("plan comparison", () => {
  it("has a row for every entitlement key and a column for every plan", () => {
    render(<PlanComparison />);

    for (const group of ENTITLEMENT_GROUPS) {
      expect(screen.getByText(group.title)).toBeInTheDocument();
      for (const key of group.keys) {
        expect(screen.getByText(ENTITLEMENT_LABELS[key])).toBeInTheDocument();
      }
    }
    for (const plan of PLANS) {
      expect(screen.getByRole("columnheader", { name: plan.name })).toBeInTheDocument();
    }
  });

  it("says an undecided limit is undecided instead of showing a dash", () => {
    render(<PlanComparison />);
    // A dash would read as "not included", which is a different claim.
    expect(screen.getAllByText("To be confirmed").length).toBeGreaterThan(0);
  });

  it("gives icon-only cells a text equivalent", () => {
    render(<PlanComparison />);
    // Included and excluded are drawn as icons; assistive technology gets words.
    expect(screen.getAllByText("Included").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not included").length).toBeGreaterThan(0);
  });
});
