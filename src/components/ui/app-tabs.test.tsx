import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppTab, AppTabList, AppTabPanel, AppTabs } from "@/components/ui/app-tabs";

function Fixture() {
  return (
    <AppTabs defaultValue="general">
      <AppTabList label="Settings sections">
        <AppTab value="general">General</AppTab>
        <AppTab value="members">Members</AppTab>
        <AppTab value="billing">Billing</AppTab>
      </AppTabList>
      <AppTabPanel value="general">General settings</AppTabPanel>
      <AppTabPanel value="members">Member list</AppTabPanel>
      <AppTabPanel value="billing">Billing details</AppTabPanel>
    </AppTabs>
  );
}

describe("AppTabs", () => {
  it("exposes the WAI-ARIA tab structure", () => {
    render(<Fixture />);
    expect(screen.getByRole("tablist", { name: "Settings sections" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent("General settings");
    // The panel names itself after the selected tab.
    expect(panel).toHaveAttribute("aria-labelledby", screen.getByRole("tab", { name: "General" }).id);
  });

  it("keeps a single tab stop with roving tabindex", () => {
    render(<Fixture />);
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Members" })).toHaveAttribute("tabindex", "-1");
  });

  it("renders only the selected panel", async () => {
    render(<Fixture />);
    expect(screen.queryByText("Member list")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Members" }));
    expect(screen.getByText("Member list")).toBeInTheDocument();
    expect(screen.queryByText("General settings")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Members" })).toHaveAttribute("aria-selected", "true");
  });

  it("moves between tabs with the arrow keys and wraps around", async () => {
    render(<Fixture />);
    const general = screen.getByRole("tab", { name: "General" });
    general.focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Members" })).toHaveFocus();
    expect(screen.getByText("Member list")).toBeInTheDocument();

    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "General" })).toHaveFocus();

    // Wrapping backwards from the first tab lands on the last.
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Billing" })).toHaveFocus();
    expect(screen.getByText("Billing details")).toBeInTheDocument();
  });

  it("jumps to the first and last tab with Home and End", async () => {
    render(<Fixture />);
    screen.getByRole("tab", { name: "Members" }).focus();

    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Billing" })).toHaveFocus();

    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "General" })).toHaveFocus();
  });

  it("reports selection changes to the caller", async () => {
    const seen: string[] = [];
    render(
      <AppTabs defaultValue="a" onValueChange={(value) => seen.push(value)}>
        <AppTabList label="Demo">
          <AppTab value="a">A</AppTab>
          <AppTab value="b">B</AppTab>
        </AppTabList>
        <AppTabPanel value="a">Panel A</AppTabPanel>
        <AppTabPanel value="b">Panel B</AppTabPanel>
      </AppTabs>,
    );

    await userEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(seen).toEqual(["b"]);
  });
});
