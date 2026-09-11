import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppButton } from "@/components/ui/app-button";

describe("AppButton", () => {
  it("renders children and forwards clicks", async () => {
    const onClick = vi.fn();
    render(<AppButton onClick={onClick}>Save</AppButton>);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled and busy while loading", async () => {
    const onClick = vi.fn();
    render(
      <AppButton loading onClick={onClick}>
        Save
      </AppButton>,
    );
    const button = screen.getByRole("button", { name: /save/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults to type=button so it never submits forms accidentally", () => {
    render(<AppButton>Noop</AppButton>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});
