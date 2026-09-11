import { describe, expect, it } from "vitest";

import { definitionErrors, validateDefinition, type WorkflowDefinition } from "@/features/workflows/domain/definition";
import { addNode, canMoveNode, createNode, moveNode, removeNode, setOutcomeTarget } from "@/features/workflows/domain/edits";
import { displayOrder } from "@/features/workflows/domain/graph";
import { templateDefinition } from "@/features/workflows/domain/templates";

function chain(): WorkflowDefinition {
  return {
    nodes: [
      { id: "trigger", type: "trigger.manual", label: "Start", config: { note: "" } },
      { id: "gen", type: "ai.generate", label: "Draft", config: { prompt: "Hi", outputKey: "answer" } },
      { id: "respond", type: "output.respond", label: "Reply", config: { message: "{{vars.answer}}" } },
    ],
    edges: [
      { id: "e1", from: "trigger", to: "gen" },
      { id: "e2", from: "gen", to: "respond" },
    ],
  };
}

describe("createNode", () => {
  it("derives a unique id from the type and clones the default config", () => {
    const first = createNode(chain(), "ai.classify");
    expect(first.id).toBe("classify");
    const withFirst = addNode(chain(), first);
    expect(createNode(withFirst, "ai.classify").id).toBe("classify_2");

    const node = createNode(chain(), "ai.classify");
    (node.config.categories as string[]).push("extra");
    expect((createNode(chain(), "ai.classify").config.categories as string[]).length).toBe(2);
  });
});

describe("addNode", () => {
  it("splices a step into an existing connection", () => {
    const base = chain();
    const node = createNode(base, "ai.classify");
    const next = addNode(base, node, { nodeId: "trigger" });
    expect(displayOrder(next)).toEqual(["trigger", "classify", "gen", "respond"]);
    expect(definitionErrors(validateDefinition(next))).toHaveLength(0);
  });

  it("appends a step when the anchor has no continuation", () => {
    const base = chain();
    const node = createNode(base, "action.send_notification");
    const next = addNode(base, node, { nodeId: "gen", outcome: "true" });
    // "true" does not match a default edge, so nothing is displaced.
    expect(next.edges.filter((edge) => edge.from === "gen")).toHaveLength(2);
  });

  it("keeps a new branch connected by inheriting the continuation as its true path", () => {
    const base = chain();
    const branch = createNode(base, "condition.branch");
    const next = addNode(base, branch, { nodeId: "trigger" });
    const fromBranch = next.edges.filter((edge) => edge.from === branch.id);
    expect(fromBranch).toHaveLength(1);
    expect(fromBranch[0]?.condition).toBe("true");
    // The missing "otherwise" outcome is reported rather than guessed.
    expect(validateDefinition(next).map((issue) => issue.code)).toContain("branch_missing_outcome");
  });
});

describe("removeNode", () => {
  it("bridges the neighbours of the removed step", () => {
    const next = removeNode(chain(), "gen");
    expect(next.nodes.map((node) => node.id)).toEqual(["trigger", "respond"]);
    expect(next.edges).toHaveLength(1);
    expect(next.edges[0]).toMatchObject({ from: "trigger", to: "respond" });
  });

  it("drops trailing edges when there is nothing to bridge to", () => {
    const next = removeNode(chain(), "respond");
    expect(next.edges.map((edge) => edge.to)).toEqual(["gen"]);
  });

  it("ignores unknown ids", () => {
    const base = chain();
    expect(removeNode(base, "nope")).toBe(base);
  });
});

describe("moveNode", () => {
  it("swaps two adjacent steps and keeps the chain intact", () => {
    const moved = moveNode(chain(), "respond", "up");
    expect(moved.moved).toBe(true);
    expect(displayOrder(moved.definition)).toEqual(["trigger", "respond", "gen"]);
    expect(moved.definition.edges).toHaveLength(2);
  });

  it("is symmetric with the opposite direction", () => {
    const down = moveNode(chain(), "gen", "down");
    const up = moveNode(chain(), "respond", "up");
    expect(displayOrder(down.definition)).toEqual(displayOrder(up.definition));
  });

  it("refuses to move the trigger or past it", () => {
    expect(canMoveNode(chain(), "trigger", "down").ok).toBe(false);
    expect(canMoveNode(chain(), "gen", "up").ok).toBe(false);
    const attempt = moveNode(chain(), "gen", "up");
    expect(attempt.moved).toBe(false);
    expect(attempt.reason).toContain("trigger");
  });

  it("refuses ambiguous moves around a branch", () => {
    const lead = templateDefinition("lead_qualification");
    const check = canMoveNode(lead, "create_contact", "up");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("branch");
  });

  it("reports the end of a path instead of moving", () => {
    const check = canMoveNode(chain(), "respond", "down");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("last step");
  });
});

describe("setOutcomeTarget", () => {
  it("re-points one branch outcome without touching the other", () => {
    const lead = templateDefinition("lead_qualification");
    const next = setOutcomeTarget(lead, "branch", "false", "respond");
    const outcomes = next.edges.filter((edge) => edge.from === "branch");
    expect(outcomes).toHaveLength(2);
    expect(outcomes.find((edge) => edge.condition === "false")?.to).toBe("respond");
    expect(outcomes.find((edge) => edge.condition === "true")?.to).toBe("create_contact");
    expect(definitionErrors(validateDefinition(next))).toHaveLength(0);
  });
});
