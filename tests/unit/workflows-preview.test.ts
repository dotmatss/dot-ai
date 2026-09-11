import { describe, expect, it } from "vitest";

import type { WorkflowDefinition } from "@/features/workflows/domain/definition";
import { describeNodeDetails, describeNodeEffect } from "@/features/workflows/domain/describe";
import { NODE_TYPES, WORKFLOW_NODE_TYPES } from "@/features/workflows/domain/node-types";
import {
  buildPreviewGraph,
  neighbourhoodOf,
  PREVIEW_NODE_HEIGHT,
  PREVIEW_NODE_WIDTH,
} from "@/features/workflows/domain/preview";

/**
 * The preview is a projection of the one workflow definition, so these tests
 * feed it the same shapes the builder can produce — including the invalid ones
 * — and assert the picture stays honest.
 */

type NodeType = (typeof WORKFLOW_NODE_TYPES)[number];

function node(id: string, type: NodeType, config?: Record<string, unknown>) {
  return { id, type, label: id, config: config ?? structuredClone(NODE_TYPES[type].defaultConfig) };
}

function definition(partial: Partial<WorkflowDefinition>): WorkflowDefinition {
  return { nodes: partial.nodes ?? [], edges: partial.edges ?? [] };
}

/** trigger → classify → branch ─ true → respond / false → notify */
const BRANCHING = definition({
  nodes: [
    node("start", "trigger.manual"),
    node("classify", "ai.classify"),
    node("check", "condition.branch"),
    node("yes", "output.respond"),
    node("no", "action.send_notification"),
  ],
  edges: [
    { id: "e1", from: "start", to: "classify" },
    { id: "e2", from: "classify", to: "check" },
    { id: "e3", from: "check", to: "yes", condition: "true" },
    { id: "e4", from: "check", to: "no", condition: "false" },
  ],
});

const byId = (graph: ReturnType<typeof buildPreviewGraph>, id: string) => {
  const found = graph.nodes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no preview node ${id}`);
  return found;
};

describe("buildPreviewGraph", () => {
  it("reports an empty definition instead of drawing one", () => {
    const graph = buildPreviewGraph(definition({}));
    expect(graph.empty).toBe(true);
    expect(graph.nodes).toEqual([]);
    expect(graph.summary).toEqual([]);
  });

  it("takes every node's presentation from the node type registry", () => {
    // Registry-driven on purpose: a node type added later (an MCP tool, an
    // agent, a knowledge lookup) is previewable without touching the preview.
    for (const type of WORKFLOW_NODE_TYPES) {
      const graph = buildPreviewGraph(definition({ nodes: [node("only", type)] }));
      const projected = byId(graph, "only");
      expect(projected.typeLabel).toBe(NODE_TYPES[type].label);
      expect(projected.category).toBe(NODE_TYPES[type].category);
      expect(projected.categoryLabel.length).toBeGreaterThan(0);
      expect(projected.summary.length).toBeGreaterThan(0);
      expect(projected.inputs).toBe(NODE_TYPES[type].inputs);
      expect(projected.outputs).toBe(NODE_TYPES[type].outputs);
    }
  });

  it("falls back to the type label when a step has no name", () => {
    const graph = buildPreviewGraph(definition({ nodes: [{ ...node("a", "ai.generate"), label: "   " }] }));
    expect(byId(graph, "a").label).toBe(NODE_TYPES["ai.generate"].label);
  });

  it("ranks steps by depth from the trigger and lays them out downwards", () => {
    const graph = buildPreviewGraph(BRANCHING);
    expect(byId(graph, "start").rank).toBe(0);
    expect(byId(graph, "classify").rank).toBe(1);
    expect(byId(graph, "check").rank).toBe(2);
    expect(byId(graph, "yes").rank).toBe(3);
    expect(byId(graph, "no").rank).toBe(3);
    expect(byId(graph, "classify").y).toBeGreaterThan(byId(graph, "start").y);
    expect(byId(graph, "yes").y).toBeGreaterThan(byId(graph, "check").y);
  });

  it("places the true branch left of the false branch", () => {
    const graph = buildPreviewGraph(BRANCHING);
    expect(byId(graph, "yes").x).toBeLessThan(byId(graph, "no").x);
    expect(byId(graph, "yes").column).toBe(0);
    expect(byId(graph, "no").column).toBe(1);
  });

  it("labels branch edges from the source node's output ports", () => {
    const graph = buildPreviewGraph(BRANCHING);
    const outcomes = graph.edges.filter((edge) => edge.from === "check");
    expect(outcomes.map((edge) => edge.label).sort()).toEqual(["If true", "Otherwise"]);
    // A sequential connection carries no outcome label to mislabel.
    expect(graph.edges.find((edge) => edge.id === "e1")?.label).toBeNull();
  });

  it("draws every kept edge with a path and a label anchor", () => {
    const graph = buildPreviewGraph(BRANCHING);
    expect(graph.edges).toHaveLength(4);
    for (const edge of graph.edges) {
      expect(edge.path.startsWith("M")).toBe(true);
      expect(Number.isFinite(edge.labelX)).toBe(true);
      expect(Number.isFinite(edge.labelY)).toBe(true);
      expect(edge.back).toBe(false);
    }
  });

  it("sizes the canvas around the nodes it placed", () => {
    const graph = buildPreviewGraph(BRANCHING);
    const right = Math.max(...graph.nodes.map((item) => item.x + PREVIEW_NODE_WIDTH));
    const bottom = Math.max(...graph.nodes.map((item) => item.y + PREVIEW_NODE_HEIGHT));
    expect(graph.width).toBeGreaterThanOrEqual(right);
    expect(graph.height).toBeGreaterThanOrEqual(bottom);
  });

  it("marks the trigger, the branch and the terminal step", () => {
    const graph = buildPreviewGraph(BRANCHING);
    expect(byId(graph, "start").isTrigger).toBe(true);
    expect(byId(graph, "check").isBranch).toBe(true);
    expect(byId(graph, "yes").isTerminal).toBe(true);
    expect(byId(graph, "classify").isTerminal).toBe(false);
  });

  it("builds a walkthrough that names where the run goes next", () => {
    const graph = buildPreviewGraph(BRANCHING);
    expect(graph.summary.map((step) => step.nodeId)).toEqual(["start", "classify", "check", "yes", "no"]);
    expect(graph.summary.map((step) => step.index)).toEqual([1, 2, 3, 4, 5]);

    const branch = graph.summary.find((step) => step.nodeId === "check");
    expect(branch?.next).toEqual([
      { outcome: "If true", label: "yes" },
      { outcome: "Otherwise", label: "no" },
    ]);
    expect(graph.summary.find((step) => step.nodeId === "yes")?.next).toEqual([]);
  });

  it("carries the validator's issue counts rather than validating again", () => {
    const graph = buildPreviewGraph(definition({ nodes: [node("a", "ai.generate", { prompt: "" })] }));
    expect(byId(graph, "a").errorCount).toBeGreaterThan(0);
    expect(graph.issues.some((issue) => issue.code === "invalid_config")).toBe(true);
  });
});

describe("buildPreviewGraph with a broken definition", () => {
  it("drops edges pointing at a deleted step and says how many", () => {
    const graph = buildPreviewGraph(
      definition({
        nodes: [node("start", "trigger.manual")],
        edges: [{ id: "e1", from: "start", to: "ghost" }],
      }),
    );
    expect(graph.edges).toEqual([]);
    expect(graph.droppedEdgeIds).toEqual(["e1"]);
    expect(graph.nodes).toHaveLength(1);
  });

  it("drops self connections and duplicate edge ids", () => {
    const graph = buildPreviewGraph(
      definition({
        nodes: [node("a", "trigger.manual"), node("b", "output.respond")],
        edges: [
          { id: "e1", from: "a", to: "a" },
          { id: "e2", from: "a", to: "b" },
          { id: "e2", from: "b", to: "a" },
        ],
      }),
    );
    expect(graph.edges.map((edge) => edge.id)).toEqual(["e2"]);
    expect(graph.droppedEdgeIds).toEqual(["e1", "e2"]);
  });

  it("keeps the first of two steps sharing an id", () => {
    const graph = buildPreviewGraph(
      definition({ nodes: [node("dup", "trigger.manual"), node("dup", "output.respond")] }),
    );
    expect(graph.nodes).toHaveLength(1);
    expect(byId(graph, "dup").type).toBe("trigger.manual");
  });

  it("still draws a cyclic definition, marking the edge that points back", () => {
    // A cycle is an error the validator reports; the preview has to keep
    // drawing while the author fixes it, and must not loop forever doing so.
    const graph = buildPreviewGraph(
      definition({
        nodes: [node("start", "trigger.manual"), node("a", "ai.generate"), node("b", "ai.classify")],
        edges: [
          { id: "e1", from: "start", to: "a" },
          { id: "e2", from: "a", to: "b" },
          { id: "e3", from: "b", to: "a" },
        ],
      }),
    );
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges.find((edge) => edge.id === "e3")?.back).toBe(true);
    expect(graph.issues.some((issue) => issue.code === "cycle")).toBe(true);
  });

  it("flags a step the trigger cannot reach", () => {
    const graph = buildPreviewGraph(
      definition({ nodes: [node("start", "trigger.manual"), node("orphan", "output.respond")] }),
    );
    expect(byId(graph, "orphan").unreachable).toBe(true);
    expect(byId(graph, "orphan").tags.map((tag) => tag.label)).toContain("Never runs");
    expect(byId(graph, "start").unreachable).toBe(false);
  });

  it("does not call every step unreachable when there is no trigger at all", () => {
    // Without a trigger the label would be true of everything and inform
    // nobody; the validator already reports the missing trigger.
    const graph = buildPreviewGraph(definition({ nodes: [node("a", "output.respond")] }));
    expect(byId(graph, "a").unreachable).toBe(false);
  });
});

describe("preview honesty about what a step does", () => {
  it("marks steps the executor only records as simulated", () => {
    const graph = buildPreviewGraph(
      definition({
        nodes: [
          node("http", "tool.http_request"),
          node("contact", "action.create_contact"),
          node("notify", "action.send_notification"),
        ],
      }),
    );
    for (const id of ["http", "contact", "notify"]) {
      expect(byId(graph, id).effect).toBe("simulated");
      expect(byId(graph, id).tags.map((tag) => tag.label)).toContain("Simulated");
    }
  });

  it("marks an HTTP step that opted in to real outbound calls as live", () => {
    const graph = buildPreviewGraph(
      definition({
        nodes: [
          node("http", "tool.http_request", {
            ...NODE_TYPES["tool.http_request"].defaultConfig,
            allowOutbound: true,
            allowedHosts: ["api.example.com"],
          }),
        ],
      }),
    );
    expect(byId(graph, "http").effect).toBe("live");
    expect(byId(graph, "http").tags.map((tag) => tag.label)).toContain("Live call");
  });

  it("treats an unparsable HTTP config as simulated, never live", () => {
    // An invalid config cannot have opted in, so it cannot reach the network.
    expect(describeNodeEffect({ id: "x", type: "tool.http_request", label: "Call", config: { allowOutbound: true } })).toBe("simulated");
  });

  it("tags AI steps so their role is visible at a glance", () => {
    const graph = buildPreviewGraph(definition({ nodes: [node("gen", "ai.generate")] }));
    expect(byId(graph, "gen").tags.map((tag) => tag.label)).toContain("AI");
  });

  it("shows no run status until one is supplied", () => {
    // A static preview must never look like a run that happened.
    const graph = buildPreviewGraph(BRANCHING);
    expect(graph.nodes.every((item) => item.state === "idle")).toBe(true);
  });

  it("accepts run state per node so execution visualization can reuse this graph", () => {
    const graph = buildPreviewGraph(BRANCHING, { states: { start: "completed", classify: "running" } });
    expect(byId(graph, "start").state).toBe("completed");
    expect(byId(graph, "classify").state).toBe("running");
    expect(byId(graph, "check").state).toBe("idle");
  });
});

describe("describeNodeDetails", () => {
  it("never exposes header values", () => {
    // An Authorization header is a credential; a shareable diagram must not
    // carry one, so only the header names are projected.
    const details = describeNodeDetails({
      id: "http",
      type: "tool.http_request",
      label: "Call the CRM",
      config: {
        ...NODE_TYPES["tool.http_request"].defaultConfig,
        headers: { Authorization: "Bearer super-secret-token", "X-Trace": "abc123" },
      },
    });
    const rendered = JSON.stringify(details);
    expect(rendered).not.toContain("super-secret-token");
    expect(rendered).not.toContain("abc123");
    expect(details.find((detail) => detail.label === "Headers")?.value).toBe("Authorization, X-Trace");
  });

  it("returns displayable details for every node type without throwing", () => {
    for (const type of WORKFLOW_NODE_TYPES) {
      const details = describeNodeDetails(node("n", type));
      expect(Array.isArray(details)).toBe(true);
      for (const detail of details) {
        expect(typeof detail.label).toBe("string");
        expect(typeof detail.value).toBe("string");
      }
    }
  });

  it("degrades to no details rather than throwing on an invalid config", () => {
    expect(describeNodeDetails({ id: "x", type: "ai.generate", label: "Write", config: { prompt: 42 } })).toEqual([]);
  });
});

describe("neighbourhoodOf", () => {
  it("returns null without a selection", () => {
    expect(neighbourhoodOf(buildPreviewGraph(BRANCHING), null)).toBeNull();
    expect(neighbourhoodOf(buildPreviewGraph(BRANCHING), "missing")).toBeNull();
  });

  it("collects everything upstream and downstream of a step", () => {
    const neighbourhood = neighbourhoodOf(buildPreviewGraph(BRANCHING), "check");
    expect([...(neighbourhood?.upstream ?? [])].sort()).toEqual(["classify", "start"]);
    expect([...(neighbourhood?.downstream ?? [])].sort()).toEqual(["no", "yes"]);
    expect(neighbourhood?.nodeIds.has("check")).toBe(true);
    expect(neighbourhood?.edgeIds.size).toBe(4);
  });

  it("excludes a sibling branch that is neither upstream nor downstream", () => {
    const neighbourhood = neighbourhoodOf(buildPreviewGraph(BRANCHING), "yes");
    expect(neighbourhood?.nodeIds.has("no")).toBe(false);
    expect(neighbourhood?.nodeIds.has("start")).toBe(true);
  });
});

describe("explicit node positions", () => {
  it("uses them when every node carries one, so a future canvas can arrange steps", () => {
    const graph = buildPreviewGraph(
      definition({
        nodes: [
          { ...node("a", "trigger.manual"), position: { x: 400, y: 40 } },
          { ...node("b", "output.respond"), position: { x: 120, y: 300 } },
        ],
        edges: [{ id: "e1", from: "a", to: "b" }],
      }),
    );
    expect({ x: byId(graph, "a").x, y: byId(graph, "a").y }).toEqual({ x: 400, y: 40 });
    expect({ x: byId(graph, "b").x, y: byId(graph, "b").y }).toEqual({ x: 120, y: 300 });
  });

  it("auto-lays out when only some nodes carry a position", () => {
    const graph = buildPreviewGraph(
      definition({
        nodes: [{ ...node("a", "trigger.manual"), position: { x: 999, y: 999 } }, node("b", "output.respond")],
        edges: [{ id: "e1", from: "a", to: "b" }],
      }),
    );
    expect(byId(graph, "a").x).not.toBe(999);
    expect(byId(graph, "b").y).toBeGreaterThan(byId(graph, "a").y);
  });
});
