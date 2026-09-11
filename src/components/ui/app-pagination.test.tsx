import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppPagination, paginationSummary } from "@/components/ui/app-pagination";

describe("AppPagination", () => {
  it("renders nothing when there is a single page and no summary", () => {
    const { container } = render(<AppPagination page={1} pageCount={1} onPageChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still renders the summary when there is only one page", () => {
    render(<AppPagination page={1} pageCount={1} onPageChange={() => {}} summary="Showing 1–3 of 3" />);
    expect(screen.getByText("Showing 1–3 of 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  });

  it("lists every page when they fit and marks the current one", () => {
    render(<AppPagination page={2} pageCount={5} onPageChange={() => {}} />);
    for (const page of ["1", "2", "3", "4", "5"]) {
      expect(screen.getByRole("button", { name: page })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "1" })).not.toHaveAttribute("aria-current");
  });

  it("collapses long ranges around the current page", () => {
    render(<AppPagination page={5} pageCount={10} onPageChange={() => {}} />);
    for (const page of ["1", "4", "5", "6", "10"]) {
      expect(screen.getByRole("button", { name: page })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "2" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "8" })).not.toBeInTheDocument();
  });

  it("disables the boundary controls instead of allowing out-of-range pages", async () => {
    const onPageChange = vi.fn();
    const { unmount } = render(<AppPagination page={1} pageCount={3} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
    unmount();

    render(<AppPagination page={3} pageCount={3} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("reports the page the user picked", async () => {
    const onPageChange = vi.fn();
    render(<AppPagination page={1} pageCount={4} onPageChange={onPageChange} />);
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("is announced as pagination navigation", () => {
    render(<AppPagination page={1} pageCount={4} onPageChange={() => {}} />);
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
  });
});

describe("paginationSummary", () => {
  it("describes the visible window", () => {
    expect(paginationSummary(1, 20, 134)).toBe("Showing 1–20 of 134");
    expect(paginationSummary(7, 20, 134)).toBe("Showing 121–134 of 134");
    expect(paginationSummary(1, 20, 0)).toBe("No results");
  });
});
