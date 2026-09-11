import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WorkflowPreview } from "@/features/workflows/components/workflow-preview";
import type { WorkflowDefinition } from "@/features/workflows/domain/definition";
import { NODE_TYPES, WORKFLOW_NODE_TYPES } from "@/features/workflows/domain/node-types";

/**
 * The preview is a read-only view of a definition, so these tests cover the
 * three things that could quietly go wrong: it stops showing the workflow, it
 * grows a way to change the workflow, or it becomes unusable without the
 * picture.
 */

type NodeType = (typeof WORKFLOW_NODE_TYPES)[number];

function node(id: string, type: NodeType, label?: string) {
  return { id, type, label: label ?? id, config: structuredClone(NODE_TYPES[type].defaultConfig) };
}

const BRANCHING: WorkflowDefinition = {
  nodes: [
    node("start", "trigger.manual", "New lead arrives"),
    node("classify", "ai.classify", "Qualify the lead"),
    node("check", "condition.branch", "Is it qualified?"),
    node("yes", "output.respond", "Send the welcome"),
    node("no", "action.send_notification", "Tell the team"),
  ],
  edges: [
    { id: "e1", from: "start", to: "classify" },
    { id: "e2", from: "classify", to: "check" },
    { id: "e3", from: "check", to: "yes", condition: "true" },
    { id: "e4", from: "check", to: "no", condition: "false" },
  ],
};

/**
 * jsdom has no layout, so every element measures zero and the canvas can never
 * fit anything. Giving it a viewport is what makes zoom and fit observable.
 */
const LAYOUT = { width: 800, height: 600 };
let originalWidth: PropertyDescriptor | undefined;
let originalHeight: PropertyDescriptor | undefined;

beforeAll(() => {
  originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => LAYOUT.width });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => LAYOUT.height });
});

afterAll(() => {
  if (originalWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalWidth);
  else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  if (originalHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalHeight);
  else Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

const zoomLevel = () => Number(screen.getByText(/^\d+%$/).textContent?.replace("%", ""));

describe("WorkflowPreview visualization", () => {
  it("draws a node for every step, named and described", () => {
    render(<WorkflowPreview definition={BRANCHING} />);
    for (const step of BRANCHING.nodes) {
      const button = screen.getByTestId(`preview-node-${step.id}`);
      expect(button).toHaveAccessibleName(new RegExp(step.label));
    }
    expect(screen.getByTestId("preview-node-classify")).toHaveAccessibleName(/Classify/);
  });

  it("counts the steps and the connections it drew", () => {
    render(<WorkflowPreview definition={BRANCHING} />);
    expect(screen.getByText(/5 steps · 4 connections/)).toBeInTheDocument();
  });

  it("labels both sides of a branch, not colour alone", () => {
    render(<WorkflowPreview definition={BRANCHING} />);
    // Once on the diagram's edge chip, once in the walkthrough.
    expect(screen.getAllByText("If true").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Otherwise").length).toBeGreaterThan(0);
  });

  it("renders every node type in the registry", () => {
    for (const type of WORKFLOW_NODE_TYPES) {
      const { unmount } = render(<WorkflowPreview definition={{ nodes: [node("only", type)], edges: [] }} />);
      expect(screen.getByTestId("preview-node-only")).toHaveAccessibleName(new RegExp(NODE_TYPES[type].label));
      unmount();
    }
  });

  it("says what a step really does instead of implying it reached an external system", () => {
    render(
      <WorkflowPreview definition={{ nodes: [node("start", "trigger.manual"), node("http", "tool.http_request")], edges: [] }} />,
    );
    expect(screen.getByTestId("preview-node-http")).toHaveAccessibleName(/Recorded rather than sent/);
  });

  it("never shows a run status, because nothing has run", () => {
    render(<WorkflowPreview definition={BRANCHING} />);
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing on this tab changes the workflow or runs it/)).toBeInTheDocument();
  });

  it("offers an empty state rather than a blank canvas", () => {
    render(<WorkflowPreview definition={{ nodes: [], edges: [] }} />);
    expect(screen.getByText("Nothing to preview yet")).toBeInTheDocument();
    expect(screen.queryByTestId("workflow-preview-viewport")).not.toBeInTheDocument();
  });

  it("keeps drawing an invalid definition and explains what is missing", () => {
    render(
      <WorkflowPreview
        definition={{ nodes: [node("start", "trigger.manual")], edges: [{ id: "e1", from: "start", to: "gone" }] }}
      />,
    );
    expect(screen.getByTestId("preview-node-start")).toBeInTheDocument();
    expect(screen.getByText("Some connections are not drawn")).toBeInTheDocument();
  });

  it("warns that a workflow with errors cannot run, without blocking the diagram", () => {
    render(<WorkflowPreview definition={{ nodes: [node("respond", "output.respond")], edges: [] }} />);
    expect(screen.getByText("This workflow cannot run yet")).toBeInTheDocument();
    expect(screen.getByTestId("preview-node-respond")).toBeInTheDocument();
  });

  it("marks a draft so a preview is not mistaken for the saved version", () => {
    render(<WorkflowPreview definition={BRANCHING} unsaved />);
    expect(screen.getByText(/showing unsaved changes/)).toBeInTheDocument();
  });
});

describe("WorkflowPreview is read-only", () => {
  it("offers no control that could edit the workflow", () => {
    render(<WorkflowPreview definition={BRANCHING} />);
    const editing = [/remove/i, /delete/i, /add step/i, /move .* up/i, /move .* down/i, /save/i, /apply/i];
    for (const pattern of editing) {
      expect(screen.queryByRole("button", { name: pattern })).not.toBeInTheDocument();
    }
    // No configuration surface: the editor lives on the Build tab.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("leaves the definition untouched however much the reader interacts", async () => {
    const user = userEvent.setup();
    const definition: WorkflowDefinition = structuredClone(BRANCHING);
    const before = JSON.stringify(definition);
    render(<WorkflowPreview definition={definition} />);

    await user.click(screen.getByTestId("preview-node-check"));
    await user.click(screen.getByTestId("preview-node-yes"));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Fit workflow to view" }));
    await user.click(screen.getByRole("button", { name: "Reset view" }));

    expect(JSON.stringify(definition)).toBe(before);
  });

  it("does not let a node be dragged out of place", async () => {
    const user = userEvent.setup();
    render(<WorkflowPreview definition={BRANCHING} />);
    const target = screen.getByTestId("preview-node-classify");
    const before = target.getAttribute("style");

    await user.pointer([
      { target, keys: "[MouseLeft>]", coords: { clientX: 10, clientY: 10 } },
      { target, coords: { clientX: 200, clientY: 160 } },
      { target, keys: "[/MouseLeft]" },
    ]);

    expect(target.getAttribute("style")).toBe(before);
  });
});

describe("WorkflowPreview navigation", () => {
  it("zooms in and out, and stops at the limits", async () => {
    const user = userEvent.setup();
    render(<WorkflowPreview definition={BRANCHING} />);
    const fitted = zoomLevel();

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoomLevel()).toBeGreaterThan(fitted);

    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(zoomLevel()).toBe(fitted);

    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    for (let click = 0; click < 12 && !zoomIn.hasAttribute("disabled"); click++) await user.click(zoomIn);
    expect(zoomIn).toBeDisabled();
    expect(zoomLevel()).toBe(200);
  });

  it("fits the whole workflow into the viewport", async () => {
    const user = userEvent.setup();
    render(<WorkflowPreview definition={BRANCHING} />);
    const fitted = zoomLevel();
    // Fitting a graph taller than the viewport has to scale it down.
    expect(fitted).toBeLessThan(100);

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Fit workflow to view" }));
    expect(zoomLevel()).toBe(fitted);
  });

  it("pans the canvas by dragging the background", async () => {
    const user = userEvent.setup();
    render(<WorkflowPreview definition={BRANCHING} />);
    const viewport = screen.getByTestId("workflow-preview-viewport");
    const surface = viewport.firstElementChild as HTMLElement;
    const before = surface.style.transform;

    await user.pointer([
      { target: viewport, keys: "[MouseLeft>]", coords: { clientX: 100, clientY: 100 } },
      { target: viewport, coords: { clientX: 180, clientY: 140 } },
      { target: viewport, keys: "[/MouseLeft]" },
    ]);

    expect(surface.style.transform).not.toBe(before);
  });

  it("selects a node and shows what it does and how it connects", async () => {
    const user = userEvent.setup();
    render(<WorkflowPreview definition={BRANCHING} />);

    await user.click(screen.getByTestId("preview-node-check"));

    expect(screen.getByTestId("preview-node-check")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(screen.getByText("Comes from")).toBeInTheDocument();
    expect(screen.getByText("Goes to")).toBeInTheDocument();
  });

  it("clears the selection when the view is reset", async () => {
    const user = userEvent.setup();
    render(<WorkflowPreview definition={BRANCHING} />);

    await user.click(screen.getByTestId("preview-node-yes"));
    expect(screen.getByTestId("preview-node-yes")).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Reset view" }));
    expect(screen.getByTestId("preview-node-yes")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("No step selected")).toBeInTheDocument();
  });

  it("selects the same node from the walkthrough as from the diagram", async () => {
    const user = userEvent.setup();
    render(<WorkflowPreview definition={BRANCHING} />);

    const walkthrough = screen.getByRole("list", { name: "Workflow walkthrough" });
    // By position: the previous step's "Then …" line names this step too, so
    // a name match would be ambiguous.
    const steps = within(walkthrough).getAllByRole("listitem");
    await user.click(within(steps[2] as HTMLElement).getByRole("button"));
    expect(screen.getByTestId("preview-node-check")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("WorkflowPreview accessibility", () => {
  it("names every navigation control", () => {
    render(<WorkflowPreview definition={BRANCHING} />);
    for (const name of ["Zoom in", "Zoom out", "Fit workflow to view", "Reset view"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("publishes the workflow as an ordered walkthrough, not only as a picture", () => {
    render(<WorkflowPreview definition={BRANCHING} />);
    const walkthrough = screen.getByRole("list", { name: "Workflow walkthrough" });
    const steps = within(walkthrough).getAllByRole("listitem");
    expect(steps).toHaveLength(BRANCHING.nodes.length);

    // Reading order, what each step does, and where the run goes next.
    expect(within(steps[0] as HTMLElement).getByText("New lead arrives")).toBeInTheDocument();
    expect(within(steps[2] as HTMLElement).getByText("If true → Send the welcome")).toBeInTheDocument();
    expect(within(steps[2] as HTMLElement).getByText("Otherwise → Tell the team")).toBeInTheDocument();
    expect(within(steps[3] as HTMLElement).getByText("The run ends here.")).toBeInTheDocument();
  });

  it("carries the step's meaning in its accessible name, since the edges are decorative", () => {
    render(<WorkflowPreview definition={BRANCHING} />);
    const name = screen.getByTestId("preview-node-check").getAttribute("aria-label") ?? "";
    expect(name).toContain("Is it qualified?");
    expect(name).toContain("Logic");
    expect(name).toContain("Branch");
  });

  it("lets a keyboard reach the nodes and select one", async () => {
    const user = userEvent.setup();
    render(<WorkflowPreview definition={BRANCHING} />);

    const first = screen.getByTestId("preview-node-start");
    first.focus();
    expect(first).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-pressed", "true");

    await user.tab();
    expect(screen.getByTestId("preview-node-classify")).toHaveFocus();
  });

  it("warns with words as well as tone", () => {
    render(
      <WorkflowPreview definition={{ nodes: [node("start", "trigger.manual"), node("orphan", "output.respond")], edges: [] }} />,
    );
    expect(screen.getByTestId("preview-node-orphan")).toHaveAccessibleName(/Nothing connects this step to the trigger/);
    expect(screen.getAllByText("Never runs").length).toBeGreaterThan(0);
  });
});
