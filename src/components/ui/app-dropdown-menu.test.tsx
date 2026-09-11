import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  AppDropdownMenu,
  AppDropdownMenuItem,
  AppDropdownMenuSeparator,
} from "@/components/ui/app-dropdown-menu";

function Fixture({ onOpen = () => {}, onArchive = () => {}, onDelete = () => {} }) {
  return (
    <AppDropdownMenu label="Chatbot actions" trigger={<button type="button">Actions</button>}>
      <AppDropdownMenuItem onSelect={onOpen}>Open</AppDropdownMenuItem>
      <AppDropdownMenuItem onSelect={onArchive}>Archive</AppDropdownMenuItem>
      <AppDropdownMenuSeparator />
      <AppDropdownMenuItem destructive onSelect={onDelete} disabled>
        Delete
      </AppDropdownMenuItem>
    </AppDropdownMenu>
  );
}

describe("AppDropdownMenu", () => {
  it("describes itself as a menu button and stays closed until asked", () => {
    render(<Fixture />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens on click, names the menu and focuses the first enabled item", async () => {
    render(<Fixture />);
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));

    const menu = screen.getByRole("menu", { name: "Chatbot actions" });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
  });

  it("cycles through enabled items with the arrow keys, skipping disabled ones", async () => {
    render(<Fixture />);
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));

    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Archive" })).toHaveFocus();

    // Delete is disabled, so the next move wraps to the first item instead.
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();

    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Archive" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<Fixture />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    await userEvent.click(trigger);

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("runs the selected action once and closes", async () => {
    const onArchive = vi.fn();
    render(<Fixture onArchive={onArchive} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("ignores a disabled item", async () => {
    const onDelete = vi.fn();
    render(<Fixture onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));

    const deleteItem = screen.getByRole("menuitem", { name: "Delete" });
    expect(deleteItem).toBeDisabled();
    expect(deleteItem).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(deleteItem, { pointerEventsCheck: 0 });
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("closes when the pointer goes down outside the menu", async () => {
    render(
      <div>
        <Fixture />
        <button type="button">Elsewhere</button>
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps the caller's own click handler on the trigger", async () => {
    const onClick = vi.fn();
    render(
      <AppDropdownMenu label="Demo" trigger={<button type="button" onClick={onClick}>Trigger</button>}>
        <AppDropdownMenuItem>Item</AppDropdownMenuItem>
      </AppDropdownMenu>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Trigger" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
