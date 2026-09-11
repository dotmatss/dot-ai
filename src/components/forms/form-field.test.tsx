import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppFormField } from "@/components/forms/form-field";
import { AppInput } from "@/components/ui/app-input";

describe("AppFormField", () => {
  it("wires label, description and error to the control", () => {
    render(
      <AppFormField label="Email" description="Work email" error="Enter a valid email" required>
        {(field) => <AppInput {...field} />}
      </AppFormField>,
    );
    const input = screen.getByLabelText(/email/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-required", "true");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Enter a valid email");
    expect(describedBy.split(" ")).toContain(error.id);
    // Description is hidden while an error is shown to keep the field concise.
    expect(screen.queryByText("Work email")).not.toBeInTheDocument();
  });

  it("shows the description when there is no error", () => {
    render(
      <AppFormField label="Name" description="Shown to your team">
        {(field) => <AppInput {...field} />}
      </AppFormField>,
    );
    expect(screen.getByText("Shown to your team")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
  });
});
