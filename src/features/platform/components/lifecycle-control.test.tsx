import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/api/http", () => ({ apiFetch: mocks.fetch }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { LifecycleControl } from "@/features/platform/components/lifecycle-control";

beforeEach(() => { vi.resetAllMocks(); mocks.fetch.mockResolvedValue({ changed: true }); });
describe("lifecycle confirmation", () => {
  it("requires an access change, a reason and the exact target before submitting", async () => {
    const user = userEvent.setup();
    render(<LifecycleControl kind="organizations" id="target" label="Acme" current="active" />);
    await user.click(screen.getByRole("button", { name: "Change access" }));
    const confirm = screen.getByRole("button", { name: "Confirm change" });
    expect(confirm).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("New status"), "suspended");
    await user.type(screen.getByLabelText(/Reason/), "Investigation");
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Type Acme to confirm"), "Acme");
    await user.click(confirm);
    expect(mocks.fetch).toHaveBeenCalledWith("/api/admin/organizations/target", {
      method: "PATCH", json: { status: "suspended", reason: "Investigation" },
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("keeps a rejected change visible for correction", async () => {
    mocks.fetch.mockRejectedValue(new Error("Access was revoked"));
    const user = userEvent.setup();
    render(<LifecycleControl kind="users" id="target" label="member@example.test" current="disabled" />);
    await user.click(screen.getByRole("button", { name: "Change access" }));
    await user.selectOptions(screen.getByLabelText("New status"), "active");
    await user.type(screen.getByLabelText("Type member@example.test to confirm"), "member@example.test");
    await user.click(screen.getByRole("button", { name: "Confirm change" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Access was revoked");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
