import { z } from "zod";

import { defaultOutgoingEdges, outgoingEdges, reachableFrom, topologicalOrder } from "@/features/workflows/domain/graph";
import { isBranchType, isTriggerType, NODE_TYPES, WORKFLOW_NODE_TYPES } from "@/features/workflows/domain/node-types";

/**
 * The definition is the persisted contract (`workflows.definition` jsonb) and
 * the only thing a future canvas builder needs to render: nodes carry an
 * optional position, edges carry an optional branch outcome. Everything else
 * about a node comes from the node type registry.
 */

export const EDGE_CONDITIONS = ["true", "false", "default"] as const;
export type EdgeCondition = (typeof EDGE_CONDITIONS)[number];

export const MAX_NODES = 60;
export const MAX_EDGES = 120;
/**
 * `agent.run` steps per definition. Each one is a full agent turn inside the
 * same request; the run also shares one wall clock across them (see
 * `WORKFLOW_AGENT_WALL_CLOCK_MS`), so beyond a handful the later steps would
 * only ever time out.
 */
export const MAX_AGENT_STEPS = 5;

const identifierSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_-]{1,40}$/, { error: "Use letters, numbers, dashes and underscores" });

export const workflowNodeSchema = z.object({
  id: identifierSchema,
  type: z.enum(WORKFLOW_NODE_TYPES),
  label: z.string().trim().min(1, { error: "Enter a step name" }).max(80, { error: "Keep the name under 80 characters" }),
  config: z.record(z.string(), z.unknown()).default({}),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type WorkflowNode = z.output<typeof workflowNodeSchema>;

export const workflowEdgeSchema = z.object({
  id: identifierSchema,
  from: identifierSchema,
  to: identifierSchema,
  condition: z.enum(EDGE_CONDITIONS).optional(),
});
export type WorkflowEdge = z.output<typeof workflowEdgeSchema>;

export const workflowDefinitionSchema = z.object({
  nodes: z.array(workflowNodeSchema).max(MAX_NODES, { error: `Up to ${MAX_NODES} steps` }).default([]),
  edges: z.array(workflowEdgeSchema).max(MAX_EDGES, { error: `Up to ${MAX_EDGES} connections` }).default([]),
});
export type WorkflowDefinition = z.output<typeof workflowDefinitionSchema>;

export const EMPTY_DEFINITION: WorkflowDefinition = { nodes: [], edges: [] };

/**
 * Rows written by an older release must not break the detail page, so an
 * unparsable definition degrades to an empty one; `validateDefinition` then
 * tells the user what to fix.
 */
export function coerceDefinition(value: unknown): WorkflowDefinition {
  const parsed = workflowDefinitionSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_DEFINITION;
}

export type DefinitionIssueSeverity = "error" | "warning";

export type DefinitionIssueCode =
  | "empty_definition"
  | "no_trigger"
  | "multiple_triggers"
  | "duplicate_node_id"
  | "duplicate_edge_id"
  | "dangling_edge"
  | "self_edge"
  | "cycle"
  | "invalid_config"
  | "too_many_agent_steps"
  | "branch_missing_outcome"
  | "unexpected_condition"
  | "unreachable_node"
  | "dead_end";

export interface DefinitionIssue {
  severity: DefinitionIssueSeverity;
  code: DefinitionIssueCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
  /** Config field the issue belongs to, for focusing the right form control. */
  field?: string;
}

function nodeName(node: WorkflowNode): string {
  return node.label.trim() || NODE_TYPES[node.type].label;
}

/**
 * Structured validation used by the builder (live), by the service before a
 * workflow may be activated, and by the executor before a run starts. Errors
 * block running; warnings are advice.
 */
export function validateDefinition(definition: WorkflowDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const { nodes, edges } = definition;

  if (nodes.length === 0) {
    return [
      {
        severity: "error",
        code: "empty_definition",
        message: "This workflow has no steps yet. Add a trigger to get started.",
      },
    ];
  }

  const seenNodeIds = new Set<string>();
  for (const node of nodes) {
    if (seenNodeIds.has(node.id)) {
      issues.push({
        severity: "error",
        code: "duplicate_node_id",
        message: `Two steps share the id “${node.id}”.`,
        nodeId: node.id,
      });
    }
    seenNodeIds.add(node.id);
  }

  const triggers = nodes.filter((node) => isTriggerType(node.type));
  if (triggers.length === 0) {
    issues.push({
      severity: "error",
      code: "no_trigger",
      message: "Add exactly one trigger so the workflow knows when to run.",
    });
  } else if (triggers.length > 1) {
    for (const extra of triggers.slice(1)) {
      issues.push({
        severity: "error",
        code: "multiple_triggers",
        message: `“${nodeName(extra)}” is a second trigger. A workflow can only have one.`,
        nodeId: extra.id,
      });
    }
  }

  const seenEdgeIds = new Set<string>();
  for (const edge of edges) {
    if (seenEdgeIds.has(edge.id)) {
      issues.push({
        severity: "error",
        code: "duplicate_edge_id",
        message: `Two connections share the id “${edge.id}”.`,
        edgeId: edge.id,
      });
    }
    seenEdgeIds.add(edge.id);

    const fromExists = seenNodeIds.has(edge.from);
    const toExists = seenNodeIds.has(edge.to);
    if (!fromExists || !toExists) {
      issues.push({
        severity: "error",
        code: "dangling_edge",
        message: `A connection points at a step that no longer exists (${!fromExists ? edge.from : edge.to}).`,
        edgeId: edge.id,
      });
    } else if (edge.from === edge.to) {
      issues.push({
        severity: "error",
        code: "self_edge",
        message: "A step cannot connect to itself.",
        edgeId: edge.id,
        nodeId: edge.from,
      });
    }
  }

  for (const node of nodes) {
    const definitionForType = NODE_TYPES[node.type];
    const parsed = definitionForType.configSchema.safeParse(node.config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path.map(String).join(".");
        issues.push({
          severity: "error",
          code: "invalid_config",
          message: `“${nodeName(node)}”: ${field ? `${field} — ` : ""}${issue.message}`,
          nodeId: node.id,
          field: field || undefined,
        });
      }
      continue;
    }
    // The schema accepts an empty agent so a step can be added before one is
    // chosen; running with one is a different matter. Reported here so the
    // builder shows it and activation is blocked, rather than every run failing
    // at this step after earlier steps have already acted.
    if (node.type === "agent.run" && !(parsed.data as { agentId?: string }).agentId) {
      issues.push({
        severity: "error",
        code: "invalid_config",
        message: `“${nodeName(node)}”: agentId — Choose an agent for this step`,
        nodeId: node.id,
        field: "agentId",
      });
    }
  }

  const agentSteps = nodes.filter((node) => node.type === "agent.run");
  if (agentSteps.length > MAX_AGENT_STEPS) {
    issues.push({
      severity: "error",
      code: "too_many_agent_steps",
      message: `Up to ${MAX_AGENT_STEPS} agent steps per workflow; this one has ${agentSteps.length}. Split the work across workflows, or let one agent delegate instead.`,
      nodeId: agentSteps[MAX_AGENT_STEPS]?.id,
    });
  }

  const { cycle } = topologicalOrder(definition);
  if (cycle.length > 0) {
    const labels = cycle
      .map((id) => nodes.find((node) => node.id === id))
      .filter((node): node is WorkflowNode => Boolean(node))
      .map(nodeName);
    issues.push({
      severity: "error",
      code: "cycle",
      message: `These steps form a loop, so the run would never finish: ${labels.join(" → ")}.`,
      nodeId: cycle[0],
    });
  }

  for (const node of nodes) {
    const outgoing = outgoingEdges(definition, node.id);
    if (isBranchType(node.type)) {
      for (const outcome of ["true", "false"] as const) {
        if (!outgoing.some((edge) => edge.condition === outcome)) {
          issues.push({
            severity: "error",
            code: "branch_missing_outcome",
            message: `“${nodeName(node)}” has no step wired to its ${outcome === "true" ? "“if true”" : "“otherwise”"} outcome.`,
            nodeId: node.id,
          });
        }
      }
      continue;
    }

    if (outgoing.some((edge) => edge.condition === "true" || edge.condition === "false")) {
      issues.push({
        severity: "warning",
        code: "unexpected_condition",
        message: `“${nodeName(node)}” is not a branch, so its outcome labels are ignored.`,
        nodeId: node.id,
      });
    }
    if (NODE_TYPES[node.type].outputs.length > 0 && defaultOutgoingEdges(definition, node.id).length === 0) {
      issues.push({
        severity: "warning",
        code: "dead_end",
        message: `The run ends after “${nodeName(node)}”. Add a response step to return a result.`,
        nodeId: node.id,
      });
    }
  }

  const trigger = triggers[0];
  if (triggers.length === 1 && trigger) {
    const reachable = reachableFrom(definition, trigger.id);
    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        issues.push({
          severity: "warning",
          code: "unreachable_node",
          message: `“${nodeName(node)}” is not connected to the trigger, so it never runs.`,
          nodeId: node.id,
        });
      }
    }
  }

  return [...issues.filter((issue) => issue.severity === "error"), ...issues.filter((issue) => issue.severity === "warning")];
}

export function definitionErrors(issues: DefinitionIssue[]): DefinitionIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}

export function findTriggerNode(definition: WorkflowDefinition): WorkflowNode | null {
  return definition.nodes.find((node) => isTriggerType(node.type)) ?? null;
}
