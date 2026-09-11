import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppCheckbox } from "@/components/ui/app-checkbox";
import { AppChip } from "@/components/ui/app-chip";
import { AppPasswordInput, AppSearchInput } from "@/components/ui/app-input";
import { AppRadio, AppRadioGroup } from "@/components/ui/app-radio";
import { AppSelect } from "@/components/ui/app-select";
import { AppSwitch } from "@/components/ui/app-switch";

describe("AppSwitch", () => {
  it("is a labelled switch that reports its state", async () => {
    const onCheckedChange = vi.fn();
    render(
      <AppSwitch
        id="branding"
        checked={false}
        onCheckedChange={onCheckedChange}
        label="Show branding"
        description="Available to remove on paid plans."
      />,
    );

    const control = screen.getByRole("switch", { name: "Show branding" });
    expect(control).toHaveAttribute("aria-checked", "false");
    await userEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("toggles from the keyboard", async () => {
    const onCheckedChange = vi.fn();
    render(<AppSwitch id="k" checked onCheckedChange={onCheckedChange} label="Enabled" />);

    screen.getByRole("switch").focus();
    await userEvent.keyboard("{Enter}");
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it("cannot be toggled while disabled", async () => {
    const onCheckedChange = vi.fn();
    render(<AppSwitch id="d" checked={false} onCheckedChange={onCheckedChange} label="Locked" disabled />);

    const control = screen.getByRole("switch");
    expect(control).toBeDisabled();
    await userEvent.click(control, { pointerEventsCheck: 0 });
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe("AppCheckbox", () => {
  it("associates its label and description with the input", async () => {
    const onChange = vi.fn();
    render(<AppCheckbox id="kb" label="Product docs" description="12 sources" onChange={onChange} />);

    const box = screen.getByRole("checkbox", { name: /Product docs/ });
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText("12 sources")).toBeInTheDocument();
  });

  it("communicates a mixed state rather than guessing", () => {
    render(<AppCheckbox id="all" label="Select all" indeterminate />);
    expect(screen.getByRole("checkbox")).toBePartiallyChecked();
  });
});

describe("AppRadioGroup", () => {
  it("groups radios under a legend and selects one at a time", async () => {
    render(
      <AppRadioGroup legend="Theme">
        <AppRadio id="light" name="theme" value="light" label="Light" defaultChecked />
        <AppRadio id="dark" name="theme" value="dark" label="Dark" />
      </AppRadioGroup>,
    );

    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
  });
});

describe("AppSelect", () => {
  it("renders its options with an optional placeholder", async () => {
    const onChange = vi.fn();
    render(
      <AppSelect
        aria-label="Model"
        defaultValue=""
        placeholder="Select a model"
        onChange={onChange}
        options={[
          { value: "fast", label: "Fast" },
          { value: "quality", label: "Highest quality" },
          { value: "legacy", label: "Legacy", disabled: true },
        ]}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Model" });
    expect(screen.getByRole("option", { name: "Select a model" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Legacy" })).toBeDisabled();

    await userEvent.selectOptions(select, "quality");
    expect(select).toHaveValue("quality");
  });
});

describe("AppPasswordInput", () => {
  it("hides the value and lets the user reveal it", async () => {
    render(<AppPasswordInput aria-label="Password" defaultValue="hunter2" />);

    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);

    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("AppSearchInput", () => {
  it("offers a clear affordance only once there is something to clear", async () => {
    const onValueChange = vi.fn();
    const { rerender } = render(<AppSearchInput value="" onValueChange={onValueChange} aria-label="Search chatbots" />);
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();

    rerender(<AppSearchInput value="support" onValueChange={onValueChange} aria-label="Search chatbots" />);
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onValueChange).toHaveBeenLastCalledWith("");
  });

  it("reports every keystroke", async () => {
    const onValueChange = vi.fn();
    render(<AppSearchInput value="" onValueChange={onValueChange} aria-label="Search" />);
    await userEvent.type(screen.getByLabelText("Search"), "a");
    expect(onValueChange).toHaveBeenCalledWith("a");
  });
});

describe("AppChip", () => {
  it("is a pressable filter when it has a click handler", async () => {
    const onClick = vi.fn();
    render(
      <AppChip selected onClick={onClick}>
        Active
      </AppChip>,
    );

    const chip = screen.getByRole("button", { name: "Active" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is static text with a remove control when it is only removable", async () => {
    const onRemove = vi.fn();
    render(<AppChip onRemove={onRemove}>Design</AppChip>);

    expect(screen.queryByRole("button", { name: "Design" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove Design" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("keeps selecting and removing as separate, non-nested controls", async () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(
      <AppChip onClick={onClick} onRemove={onRemove}>
        Support
      </AppChip>,
    );

    const select = screen.getByRole("button", { name: "Support" });
    const remove = screen.getByRole("button", { name: "Remove Support" });
    // Nested buttons are invalid HTML; the remove control must be a sibling.
    expect(select.contains(remove)).toBe(false);

    await userEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();

    await userEvent.click(select);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
