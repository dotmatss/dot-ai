import { describe, expect, it } from "vitest";

import {
  coerceDefinition,
  definitionErrors,
  validateDefinition,
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from "@/features/workflows/domain/definition";
import { NODE_TYPES, WORKFLOW_NODE_TYPES, nodeTypesByCategory } from "@/features/workflows/domain/node-types";
import { WORKFLOW_TEMPLATES, templateDefinition } from "@/features/workflows/domain/templates";

function node(id: string, type: (typeof WORKFLOW_NODE_TYPES)[number], config?: Record<string, unknown>) {
  return { id, type, label: id, config: config ?? structuredClone(NODE_TYPES[type].defaultConfig) };
}

function definition(partial: Partial<WorkflowDefinition>): WorkflowDefinition {
  return { nodes: partial.nodes ?? [], edges: partial.edges ?? [] };
}

const codes = (value: WorkflowDefinition) => validateDefinition(value).map((issue) => issue.code);

describe("validateDefinition", () => {
  it("reports an empty definition once", () => {
    expect(codes(definition({}))).toEqual(["empty_definition"]);
  });

  it("requires exactly one trigger", () => {
    const missing = definition({ nodes: [node("respond", "output.respond")] });
    expect(codes(missing)).toContain("no_trigger");

    const two = definition({
      nodes: [node("a", "trigger.manual"), node("b", "trigger.webhook")],
      edges: [{ id: "e1", from: "a", to: "b" }],
    });
    expect(codes(two)).toContain("multiple_triggers");
  });

  it("reports dangling edges", () => {
    const value = definition({
      nodes: [node("trigger", "trigger.manual")],
      edges: [{ id: "e1", from: "trigger", to: "ghost" }],
    });
    const issues = validateDefinition(value);
    expect(issues.some((issue) => issue.code === "dangling_edge" && issue.edgeId === "e1")).toBe(true);
  });

  it("reports cycles as errors", () => {
    const value = definition({
      nodes: [node("trigger", "trigger.manual"), node("a", "ai.generate"), node("b", "output.respond")],
      edges: [
        { id: "e1", from: "trigger", to: "a" },
        { id: "e2", from: "a", to: "b" },
        { id: "e3", from: "b", to: "a" },
      ],
    });
    expect(codes(value)).toContain("cycle");
  });

  it("validates each node config against its type schema", () => {
    const value = definition({
      nodes: [node("trigger", "trigger.manual"), node("gen", "ai.generate", { prompt: "" })],
      edges: [{ id: "e1", from: "trigger", to: "gen" }],
    });
    const issues = definitionErrors(validateDefinition(value));
    const configIssue = issues.find((issue) => issue.code === "invalid_config");
    expect(configIssue?.nodeId).toBe("gen");
    expect(configIssue?.field).toBe("prompt");
  });

  it("requires both branch outcomes to be wired", () => {
    const value = definition({
      nodes: [node("trigger", "trigger.manual"), node("branch", "condition.branch"), node("yes", "output.respond")],
      edges: [
        { id: "e1", from: "trigger", to: "branch" },
        { id: "e2", from: "branch", to: "yes", condition: "true" },
      ],
    });
    const issues = validateDefinition(value).filter((issue) => issue.code === "branch_missing_outcome");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("otherwise");
  });

  it("reports unreachable steps as warnings, not errors", () => {
    const value = definition({
      nodes: [node("trigger", "trigger.manual"), node("orphan", "output.respond")],
      edges: [],
    });
    const issues = validateDefinition(value);
    expect(definitionErrors(issues)).toHaveLength(0);
    expect(issues.map((issue) => issue.code)).toContain("unreachable_node");
  });

  it("orders errors before warnings", () => {
    const value = definition({
      nodes: [node("orphan", "output.respond"), node("dead", "ai.generate")],
      edges: [],
    });
    const severities = validateDefinition(value).map((issue) => issue.severity);
    expect(severities.indexOf("error")).toBeLessThan(severities.lastIndexOf("warning"));
  });
});

describe("workflowDefinitionSchema", () => {
  it("defaults config and keeps optional positions", () => {
    const parsed = workflowDefinitionSchema.parse({
      nodes: [{ id: "trigger", type: "trigger.manual", label: "Start", position: { x: 10, y: 4 } }],
      edges: [],
    });
    expect(parsed.nodes[0]?.config).toEqual({});
    expect(parsed.nodes[0]?.position).toEqual({ x: 10, y: 4 });
  });

  it("rejects unknown node types and malformed ids", () => {
    expect(workflowDefinitionSchema.safeParse({ nodes: [{ id: "a", type: "nope", label: "x" }], edges: [] }).success).toBe(false);
    expect(workflowDefinitionSchema.safeParse({ nodes: [{ id: "a b", type: "trigger.manual", label: "x" }], edges: [] }).success).toBe(
      false,
    );
  });

  it("degrades an unparsable stored definition to an empty one", () => {
    expect(coerceDefinition({ nodes: "broken" })).toEqual({ nodes: [], edges: [] });
    expect(coerceDefinition(null)).toEqual({ nodes: [], edges: [] });
  });
});

describe("node type registry", () => {
  it("exposes every type through the picker groups", () => {
    const grouped = nodeTypesByCategory().flatMap((group) => group.types.map((type) => type.id));
    expect(grouped.sort()).toEqual([...WORKFLOW_NODE_TYPES].sort());
  });

  it("has default config that satisfies its own schema", () => {
    for (const type of WORKFLOW_NODE_TYPES) {
      const nodeType = NODE_TYPES[type];
      expect(nodeType.configSchema.safeParse(nodeType.defaultConfig).success, `${type} default config`).toBe(true);
    }
  });

  it("has one field descriptor per config key, and no reserved key collision", () => {
    for (const type of WORKFLOW_NODE_TYPES) {
      const nodeType = NODE_TYPES[type];
      const schemaKeys = Object.keys(nodeType.configSchema.shape).sort();
      const fieldNames = nodeType.fields.map((field) => field.name).sort();
      expect(fieldNames, `${type} fields`).toEqual(schemaKeys);
      // The config panel adds a `stepLabel` control to the same form.
      expect(schemaKeys).not.toContain("stepLabel");
    }
  });

  it("gives triggers no inputs and terminal steps no outputs", () => {
    expect(NODE_TYPES["trigger.manual"].inputs).toHaveLength(0);
    expect(NODE_TYPES["output.respond"].outputs).toHaveLength(0);
    expect(NODE_TYPES["condition.branch"].outputs.map((port) => port.id)).toEqual(["true", "false"]);
  });
});

describe("workflow templates", () => {
  it("produces definitions without errors", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(definitionErrors(validateDefinition(template.definition)), template.id).toHaveLength(0);
    }
  });

  it("returns a clone so edits cannot leak between workflows", () => {
    const first = templateDefinition("faq_responder");
    const firstNode = first.nodes[0];
    if (firstNode) firstNode.label = "changed";
    expect(templateDefinition("faq_responder").nodes[0]?.label).toBe("New conversation");
  });

  it("wires lead qualification through a branch", () => {
    const lead = templateDefinition("lead_qualification");
    const outcomes = lead.edges.filter((edge) => edge.from === "branch").map((edge) => edge.condition);
    expect(outcomes.sort()).toEqual(["false", "true"]);
  });
});
