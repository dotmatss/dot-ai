import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppBarChart, type BarDatum } from "@/components/charts/app-bar-chart";
import { AppSparkline } from "@/components/charts/app-sparkline";

const DATA: BarDatum[] = [
  { label: "Sep 1", value: 12 },
  { label: "Sep 2", value: 1234 },
  { label: "Sep 3", value: 0 },
];

describe("AppBarChart", () => {
  it("names the chart and offers the same numbers as a table", () => {
    render(<AppBarChart data={DATA} title="Visitor messages per day" valueLabel="Messages" />);

    expect(screen.getByRole("img", { name: /Visitor messages per day/ })).toBeInTheDocument();

    // Every value is reachable without seeing the chart.
    const table = screen.getByRole("table", { name: "Visitor messages per day" });
    expect(within(table).getByRole("rowheader", { name: "Sep 2" })).toBeInTheDocument();
    expect(within(table).getByText("1,234")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(DATA.length + 1);
  });

  it("labels each mark for assistive technology", () => {
    render(<AppBarChart data={DATA} title="Messages" valueLabel="Messages" />);
    const marks = screen.getAllByRole("graphics-symbol");
    expect(marks).toHaveLength(DATA.length);
    expect(marks[1]).toHaveAccessibleName("Sep 2: 1,234");
  });

  it("shows no legend for a single series", () => {
    // One series needs no legend: the title already says what is plotted.
    const { container } = render(<AppBarChart data={DATA} title="Messages" valueLabel="Messages" />);
    expect(container.querySelector("figcaption")).toBeNull();
  });

  it("adds a legend once a comparison series is present", () => {
    const { container } = render(
      <AppBarChart
        data={DATA.map((d) => ({ ...d, compare: d.value / 2 }))}
        title="Messages"
        valueLabel="This period"
        compareLabel="Previous period"
      />,
    );

    const legend = container.querySelector("figcaption");
    expect(legend).toHaveTextContent("This period");
    expect(legend).toHaveTextContent("Previous period");

    // The comparison column joins the table too.
    const table = screen.getByRole("table", { name: "Messages" });
    expect(within(table).getByRole("columnheader", { name: "Previous period" })).toBeInTheDocument();
  });

  it("reveals a tooltip on hover and on keyboard focus alike", async () => {
    render(<AppBarChart data={DATA} title="Messages" valueLabel="Messages" />);
    const marks = screen.getAllByRole("graphics-symbol");

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await userEvent.hover(marks[1]!);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Sep 2");
    expect(tooltip).toHaveTextContent("Messages: 1,234");

    await userEvent.unhover(marks[1]!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Keyboard users get the same information.
    fireEvent.focus(marks[0]!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Sep 1");
    fireEvent.blur(marks[0]!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("draws the plot in HTML so the type is not scaled with it", () => {
    // The bars used to live in a viewBox, which multiplied every unit inside
    // it - type included - by (rendered width / 600).
    const { container } = render(<AppBarChart data={DATA} title="Messages" valueLabel="Messages" />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("survives degenerate data instead of dividing by zero", () => {
    render(<AppBarChart data={[]} title="Nothing yet" />);
    expect(screen.getByRole("img", { name: /Nothing yet/ })).toBeInTheDocument();

    render(<AppBarChart data={[{ label: "a", value: 0 }]} title="All zero" />);
    expect(screen.getByRole("img", { name: /All zero/ })).toBeInTheDocument();
  });
});

describe("AppSparkline", () => {
  it("summarises the trend for screen readers", () => {
    render(<AppSparkline values={[1, 5, 3, 9]} label="Messages per day" />);
    const image = screen.getByRole("img");
    expect(image).toHaveAccessibleName("Messages per day. Latest value 9, high 9, low 1.");
  });

  it("renders nothing when there is not enough data to show a trend", () => {
    const { container } = render(<AppSparkline values={[1]} label="Messages per day" />);
    expect(container).toBeEmptyDOMElement();
  });
});
