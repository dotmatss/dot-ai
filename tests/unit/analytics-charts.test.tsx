import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { axisLabelIndices } from "@/components/charts/axis";
import { AnalyticsAreaChart, type AnalyticsChartPoint } from "@/features/analytics/components/analytics-area-chart";
import { AnalyticsBarRows } from "@/features/analytics/components/analytics-bar-rows";

const POINTS: AnalyticsChartPoint[] = [
  { key: "a", label: "Mar 4", rangeLabel: "Mar 4", current: 12, previous: 6, previousRangeLabel: "Feb 26" },
  { key: "b", label: "Mar 5", rangeLabel: "Mar 5", current: 0, previous: 4, previousRangeLabel: "Feb 27" },
  { key: "c", label: "Mar 6", rangeLabel: "Mar 6", current: 1234, previous: 0, previousRangeLabel: "Feb 28" },
];

describe("AnalyticsAreaChart", () => {
  it("names the chart and offers the same numbers as a table", () => {
    // An SVG on its own is not readable, so the table is the contract.
    render(
      <AnalyticsAreaChart id="chart" title="Conversations per day" points={POINTS} currentLabel="This period" />,
    );

    expect(screen.getByRole("img", { name: "Conversations per day" })).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Conversations per day" });
    expect(within(table).getByRole("rowheader", { name: "Mar 6" })).toBeInTheDocument();
    expect(within(table).getByText("1,234")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(POINTS.length + 1);
  });

  it("adds the comparison column and legend only when a previous series is given", () => {
    const { container, rerender } = render(
      <AnalyticsAreaChart
        id="chart"
        title="Conversations"
        points={POINTS}
        currentLabel="This period"
        previousLabel="Previous period"
      />,
    );

    const table = screen.getByRole("table", { name: "Conversations" });
    expect(within(table).getByRole("columnheader", { name: "Previous period" })).toBeInTheDocument();
    expect(container.querySelector("figcaption")).toHaveTextContent("Previous period");

    rerender(
      <AnalyticsAreaChart
        id="chart"
        title="Conversations"
        points={POINTS.map((point) => ({ ...point, previous: undefined, previousRangeLabel: null }))}
        currentLabel="This period"
        previousLabel="Previous period"
      />,
    );

    expect(screen.queryByRole("columnheader", { name: "Previous period" })).toBeNull();
    expect(container.querySelector("figcaption")).not.toHaveTextContent("Previous period");
  });

  it("marks a lone bucket, which would otherwise draw an invisible line", () => {
    const { container } = render(
      <AnalyticsAreaChart
        id="chart"
        title="Conversations"
        points={[{ key: "a", label: "Mar 4", rangeLabel: "Mar 4", current: 3 }]}
        currentLabel="This period"
      />,
    );

    expect(container.querySelector("circle")).not.toBeNull();
    expect(screen.getByRole("table", { name: "Conversations" })).toBeInTheDocument();
  });

  it("keeps type out of the scaled viewBox", () => {
    // A viewBox multiplies every unit inside it by (rendered width / 640), so
    // an 11px label in a full width card rendered at well over 20px. Labels are
    // HTML now, and the plot no longer scales vertically at all.
    const { container } = render(
      <AnalyticsAreaChart id="chart" title="Conversations" points={POINTS} currentLabel="This period" height={220} />,
    );

    const plot = container.querySelector("svg[viewBox]");
    expect(plot?.querySelector("text")).toBeNull();
    expect(plot).toHaveAttribute("preserveAspectRatio", "none");
    expect(plot).toHaveStyle({ height: "220px" });
  });

  it("draws an all-zero period without collapsing the axis", () => {
    const { container } = render(
      <AnalyticsAreaChart
        id="chart"
        title="Conversations"
        points={POINTS.map((point) => ({ ...point, current: 0, previous: 0 }))}
        currentLabel="This period"
      />,
    );

    // niceCeil keeps a maximum of 1, so the line sits on the baseline.
    expect(container.querySelectorAll("polyline")[0]?.getAttribute("points")).toContain(",");
    expect(within(screen.getByRole("table", { name: "Conversations" })).getAllByText("0").length).toBeGreaterThan(0);
  });
});

describe("axisLabelIndices", () => {
  it("keeps every bucket when they all fit", () => {
    expect(axisLabelIndices(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("thins labels so 90 daily buckets do not collide", () => {
    const indices = axisLabelIndices(90);
    expect(indices).toHaveLength(8);
    expect(indices[0]).toBe(0);
    expect(indices.at(-1)).toBe(89);
  });

  it("never prints the last label on top of its neighbour", () => {
    // 30 buckets step by 4, which would otherwise label both 28 and 29 - the
    // "Sep 12" printed over "Sep 13" in the 30 day analytics view.
    const indices = axisLabelIndices(30);
    expect(indices).toContain(29);
    expect(indices).not.toContain(28);
  });

  it("survives degenerate counts", () => {
    expect(axisLabelIndices(0)).toEqual([]);
    expect(axisLabelIndices(1)).toEqual([0]);
    expect(axisLabelIndices(2)).toEqual([0, 1]);
  });
});

describe("AnalyticsBarRows", () => {
  const rows = [
    { id: "widget", label: "Widget", value: 30 },
    { id: "api", label: "API", value: 10 },
  ];

  it("writes every number next to its label and hides the bar from assistive tech", () => {
    const { container } = render(<AnalyticsBarRows rows={rows} total={40} valueLabel="conversations" />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Widget");
    expect(items[0]).toHaveTextContent("30 conversations · 75%");
    expect(items[1]).toHaveTextContent("10 conversations · 25%");
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(2);
  });

  it("scales bars to the largest row but takes the share from the real total", () => {
    // A ranked list may show only the top rows, so the denominator is passed in
    // rather than summed from what happens to be rendered.
    const { container } = render(<AnalyticsBarRows rows={rows} total={100} valueLabel="messages" />);

    const bars = container.querySelectorAll('[aria-hidden="true"] > div');
    expect(bars[0]).toHaveStyle({ width: "100%" });
    expect(bars[1]).toHaveStyle({ width: "33.33%" });
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("30%");
  });
});
