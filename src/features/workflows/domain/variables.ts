import type { ConditionOperator } from "@/features/workflows/domain/node-types";

/**
 * Run variables and `{{path.to.value}}` templates.
 *
 * Templates are deliberately not an expression language: only dotted paths
 * into the run context are resolved, so a workflow definition can never
 * execute code and stays safe to render on the server.
 */

export interface RunContext {
  /** Payload that started the run (webhook body, conversation, manual note). */
  trigger: Record<string, unknown>;
  /** Values collected by input steps. */
  input: Record<string, unknown>;
  /** Values written by steps via their `outputKey`. */
  vars: Record<string, unknown>;
  /** Raw output of each step, keyed by node id. */
  nodes: Record<string, unknown>;
}

export function createRunContext(partial: Partial<RunContext> = {}): RunContext {
  return {
    trigger: partial.trigger ?? {},
    input: partial.input ?? {},
    vars: partial.vars ?? {},
    nodes: partial.nodes ?? {},
  };
}

/** What to do when a template references a value the run does not have. */
export type MissingVariablePolicy = "empty" | "keep" | "error";

export class MissingVariableError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Missing value for {{${path}}}`);
    this.name = "MissingVariableError";
    this.path = path;
  }
}

/** A path segment list from `a.b[0].c` style paths. */
function pathSegments(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function resolvePath(context: unknown, path: string): unknown {
  let current: unknown = context;
  for (const segment of pathSegments(path)) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Stringifies a resolved value for interpolation into a template. */
export function formatVariableValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

/** Matches `{{ path.to.value }}`; constructed per call so `lastIndex` is never shared. */
function templatePattern(): RegExp {
  return /\{\{\s*([a-zA-Z0-9_.[\]-]+)\s*\}\}/g;
}

export function collectTemplateVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(templatePattern())) {
    const path = match[1];
    if (path) found.add(path);
  }
  return [...found];
}

export interface RenderResult {
  text: string;
  /** Paths that resolved to nothing, in first-seen order. */
  missing: string[];
}

export function renderTemplate(
  template: string,
  context: RunContext,
  options: { policy?: MissingVariablePolicy } = {},
): RenderResult {
  const policy = options.policy ?? "empty";
  const missing: string[] = [];
  const text = template.replace(templatePattern(), (match, rawPath: string) => {
    const value = resolvePath(context, rawPath);
    if (value === undefined || value === null || value === "") {
      if (!missing.includes(rawPath)) missing.push(rawPath);
      if (policy === "error") throw new MissingVariableError(rawPath);
      return policy === "keep" ? match : "";
    }
    return formatVariableValue(value);
  });
  return { text, missing };
}

export interface ConditionInput {
  left: string;
  operator: ConditionOperator;
  right: string;
  caseSensitive?: boolean;
}

export interface ConditionResult {
  result: boolean;
  /** Rendered operands, kept for the run timeline so a false branch is explainable. */
  left: string;
  right: string;
  missing: string[];
}

/**
 * Evaluates a branch condition. Operands are rendered with the "empty" policy
 * so a missing variable is a falsy comparison rather than a failed run;
 * `missing` is reported so the step output still shows what was absent.
 */
export function evaluateCondition(condition: ConditionInput, context: RunContext): ConditionResult {
  const left = renderTemplate(condition.left, context);
  const right = renderTemplate(condition.right, context);
  const missing = [...new Set([...left.missing, ...right.missing])];
  const fold = (value: string) => (condition.caseSensitive ? value : value.toLowerCase());

  let result = false;
  switch (condition.operator) {
    case "equals":
      result = fold(left.text) === fold(right.text);
      break;
    case "contains":
      result = right.text.length > 0 && fold(left.text).includes(fold(right.text));
      break;
    case "gt":
    case "lt": {
      const leftNumber = Number(left.text);
      const rightNumber = Number(right.text);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        result = condition.operator === "gt" ? leftNumber > rightNumber : leftNumber < rightNumber;
      }
      break;
    }
    case "exists":
      result = left.text.trim().length > 0;
      break;
  }

  return { result, left: left.text, right: right.text, missing };
}
