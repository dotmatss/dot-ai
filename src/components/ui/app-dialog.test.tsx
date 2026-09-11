import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppConfirmDialog, AppDialog } from "@/components/ui/app-dialog";

describe("AppDialog", () => {
  it("renders nothing visible until it is opened", () => {
    render(
      <AppDialog open={false} onClose={() => {}} title="Edit task">
        <p>Body</p>
      </AppDialog>,
    );
    expect(screen.queryByText("Edit task")).not.toBeInTheDocument();
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
  });

  it("names and describes itself for assistive technology", () => {
    render(
      <AppDialog open onClose={() => {}} title="Edit task" description="Change the task details.">
        <p>Body</p>
      </AppDialog>,
    );

    const dialog = screen.getByRole("dialog");
    const heading = screen.getByRole("heading", { name: "Edit task" });
    expect(dialog).toHaveAttribute("aria-labelledby", heading.id);
    expect(dialog.getAttribute("aria-describedby")).toBe(screen.getByText("Change the task details.").id);
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("closes from the header button", async () => {
    const onClose = vi.fn();
    render(<AppDialog open onClose={onClose} title="Edit task" />);
    await userEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(
      <AppDialog open onClose={onClose} title="Edit task">
        <p>Body</p>
      </AppDialog>,
    );

    // Clicking the dialog element itself is the backdrop; clicking content is not.
    await userEvent.click(screen.getByText("Body"));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores the backdrop and Escape while it is not dismissible", async () => {
    const onClose = vi.fn();
    render(
      <AppDialog open onClose={onClose} title="Saving" dismissible={false}>
        <p>Body</p>
      </AppDialog>,
    );

    await userEvent.click(screen.getByRole("dialog"));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape, without letting the browser close it behind React's back", () => {
    const onClose = vi.fn();
    render(<AppDialog open onClose={onClose} title="Edit task" />);

    const cancelEvent = new Event("cancel", { cancelable: true });
    fireEvent(screen.getByRole("dialog"), cancelEvent);

    expect(onClose).toHaveBeenCalledTimes(1);
    // The native close is prevented so the component stays a controlled dialog.
    expect(cancelEvent.defaultPrevented).toBe(true);
  });

  it("renders footer actions", async () => {
    const onClose = vi.fn();
    render(
      <AppDialog open onClose={onClose} title="Edit task" footer={<button type="button">Save changes</button>} />,
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });
});

describe("AppConfirmDialog", () => {
  it("wires confirm and cancel and marks destructive intent", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <AppConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete “Support Assistant”?"
        description="This cannot be undone."
        confirmLabel="Delete chatbot"
        destructive
      />,
    );

    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete chatbot" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks the dialog down while the action is in flight", () => {
    render(
      <AppConfirmDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete?"
        confirmLabel="Delete"
        loading
        destructive
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    const confirm = screen.getByRole("button", { name: /Delete/ });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
  });
});
