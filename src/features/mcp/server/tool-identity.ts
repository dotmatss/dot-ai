import "server-only";

import { createHash } from "node:crypto";

import type { McpToolAnnotationClaims } from "@/features/mcp/types";

/**
 * The content hash that pins a customer's approval to what they approved.
 *
 * ## Why a hash at all
 *
 * A tool name is not an identity. The specification says the tool set "**MAY**
 * change over time", and nothing stops a server operator from redefining
 * `search_contacts` on Tuesday to drain the CRM, or from rewriting its
 * description to carry instructions to the model. A grant keyed on the name
 * alone silently follows that change. So an approval is pinned to a hash of
 * what the customer actually saw, and a change makes the grant stale rather
 * than continuing to authorise something nobody reviewed.
 *
 * ## The canonical representation, defined exactly
 *
 * Hashed, because each one changes what the tool does or what the model is
 * told it does:
 *
 * | Field | Why |
 * | --- | --- |
 * | `name` | The identifier the model calls |
 * | `description` | Reaches the model as context. The prompt-injection surface |
 * | `inputSchema` | Determines what arguments the model is asked to produce |
 * | `outputSchema` | Determines how the result is interpreted |
 * | `annotations` | A flip from `destructiveHint: true` to `false` is exactly the lie to catch |
 *
 * Deliberately NOT hashed:
 *
 * | Field | Why not |
 * | --- | --- |
 * | `title` | Presentation only. A copy edit should not revoke a working grant |
 * | `icons` | Presentation, and the URLs are free to churn |
 * | `_meta` | Extensible by design, so not deterministic. Hashing it would produce spurious staleness, which trains people to click through the warning |
 *
 * That last row is why this module exists rather than a one-line
 * `sha256(JSON.stringify(tool))`. A hash that cries wolf is worse than none.
 *
 * ## Canonicalisation
 *
 * JSON object key order is not significant and is not stable across servers,
 * serialisers or protocol revisions, so two equivalent definitions must hash
 * the same: keys are sorted recursively and `undefined` is dropped. Array
 * order IS preserved, because in JSON Schema (`required`, `enum`, `oneOf`)
 * order can carry meaning and a reordering is worth noticing.
 */

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value === null || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    out[key] = canonicalise(source[key]);
  }
  return out;
}

/** Only the four specified hints, in a fixed order, so unknown keys cannot shift the hash. */
function canonicalAnnotations(annotations: McpToolAnnotationClaims): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (annotations.readOnlyHint !== undefined) out.readOnlyHint = annotations.readOnlyHint;
  if (annotations.destructiveHint !== undefined) out.destructiveHint = annotations.destructiveHint;
  if (annotations.idempotentHint !== undefined) out.idempotentHint = annotations.idempotentHint;
  if (annotations.openWorldHint !== undefined) out.openWorldHint = annotations.openWorldHint;
  return out;
}

export interface HashableTool {
  name: string;
  description?: string | null;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  annotations?: McpToolAnnotationClaims;
}

/**
 * The exact string that gets hashed. Exported so a test can pin its shape:
 * if this changes, every stored grant goes stale, so it must never change by
 * accident.
 */
export function canonicalToolRepresentation(tool: HashableTool): string {
  return JSON.stringify(
    canonicalise({
      // A version tag, so that revising this definition later is a deliberate,
      // visible act: every hash changes and every grant goes stale at once,
      // rather than some tools silently comparing across two schemes.
      v: 1,
      name: tool.name,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema ?? null,
      annotations: canonicalAnnotations(tool.annotations ?? {}),
    }),
  );
}

export function toolContentHash(tool: HashableTool): string {
  return createHash("sha256").update(canonicalToolRepresentation(tool), "utf8").digest("hex");
}
