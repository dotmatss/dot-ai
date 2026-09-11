import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSearchParamState } from "@/hooks/use-search-param-state";

const replace = vi.fn();
let pathname = "/w/acme/chatbots";
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

const KEYS = ["q", "status", "page"] as const;

function lastUrl(): string {
  return String(replace.mock.calls.at(-1)?.[0] ?? "");
}

beforeEach(() => {
  replace.mockClear();
  pathname = "/w/acme/chatbots";
  search = "";
});

describe("useSearchParamState", () => {
  it("reads the requested keys from the URL", () => {
    search = "?q=support&status=active&other=ignored";
    const { result } = renderHook(() => useSearchParamState(KEYS));

    expect(result.current[0]).toEqual({ q: "support", status: "active", page: undefined });
  });

  it("writes values into the URL without scrolling the page", () => {
    const { result } = renderHook(() => useSearchParamState(KEYS));
    act(() => {
      result.current[1]({ status: "paused" });
    });

    expect(lastUrl()).toBe("/w/acme/chatbots?status=paused");
    expect(replace.mock.calls.at(-1)?.[1]).toEqual({ scroll: false });
  });

  it("removes a filter when it is cleared", () => {
    search = "?q=support&status=active";
    const { result } = renderHook(() => useSearchParamState(KEYS));

    act(() => {
      result.current[1]({ q: undefined });
    });
    expect(lastUrl()).toBe("/w/acme/chatbots?status=active");

    act(() => {
      result.current[1]({ status: "" });
    });
    expect(lastUrl()).toBe("/w/acme/chatbots?q=support");
  });

  it("drops the query string entirely when nothing is left", () => {
    search = "?q=support";
    const { result } = renderHook(() => useSearchParamState(KEYS));
    act(() => {
      result.current[1]({ q: undefined });
    });

    expect(lastUrl()).toBe("/w/acme/chatbots");
  });

  it("resets pagination when a filter changes, so page 5 of an old result set is not shown", () => {
    search = "?page=5&status=active";
    const { result } = renderHook(() => useSearchParamState(KEYS));
    act(() => {
      result.current[1]({ status: "paused" });
    });

    expect(lastUrl()).toBe("/w/acme/chatbots?status=paused");
  });

  it("keeps the page when the page itself is what changed", () => {
    search = "?status=active";
    const { result } = renderHook(() => useSearchParamState(KEYS));
    act(() => {
      result.current[1]({ page: 3 });
    });

    expect(lastUrl()).toBe("/w/acme/chatbots?status=active&page=3");
  });

  it("honours an explicit resetPage override", () => {
    search = "?page=4";
    const { result } = renderHook(() => useSearchParamState(KEYS));
    act(() => {
      result.current[1]({ q: "support" }, { resetPage: false });
    });

    expect(lastUrl()).toBe("/w/acme/chatbots?page=4&q=support");
  });

  it("preserves parameters it does not manage", () => {
    search = "?tab=overview&q=support";
    const { result } = renderHook(() => useSearchParamState(KEYS));
    act(() => {
      result.current[1]({ q: "billing" });
    });

    expect(lastUrl()).toContain("tab=overview");
    expect(lastUrl()).toContain("q=billing");
  });
});
