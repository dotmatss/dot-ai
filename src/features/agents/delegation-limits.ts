import { z } from "zod";

/**
 * Hard limits on multi-agent execution.
 *
 * A supervisor turn runs inline, inside one HTTP request: the supervisor's own
 * completions plus a full turn for every child it delegates to. Nothing queues
 * and nothing resumes, so the only thing standing between a delegating agent
 * and an unbounded bill is this file.
 *
 * These are enforced by `delegation.ts` before a child is started. They are
 * never stated to the model as instructions - a limit a model is asked to
 * respect is a limit that holds until the first unusual prompt.
 */

/** What a workspace gets unless it configures otherwise. */
export const DELEGATION_DEFAULTS = {
  /** Supervisor → child is depth 1; that child delegating again is depth 2. */
  maxDepth: 2,
  /** Child executions permitted across one root request, at any depth. */
  maxDelegations: 3,
  /** Wall-clock budget for the whole tree, from the root turn's first token. */
  timeoutMs: 60_000,
  /** Combined prompt + completion tokens across every agent in the tree. */
  tokenBudget: 100_000,
} as const;

/**
 * The most an operator may raise a limit to.
 *
 * `delegation_config` is jsonb, and jsonb is customer-writable data. Parsing it
 * without a ceiling would make the budget advisory, so every value is clamped
 * here and a stored number above the ceiling is lowered rather than honoured.
 */
export const DELEGATION_CEILINGS = {
  maxDepth: 3,
  maxDelegations: 5,
  timeoutMs: 120_000,
  tokenBudget: 250_000,
} as const;

export interface DelegationConfig {
  maxDepth: number;
  maxDelegations: number;
  timeoutMs: number;
  tokenBudget: number;
}

function clamped(field: keyof DelegationConfig, min: number) {
  return z.coerce
    .number()
    .int()
    .catch(DELEGATION_DEFAULTS[field])
    .transform((value) => Math.min(Math.max(value, min), DELEGATION_CEILINGS[field]));
}

/**
 * Parses `agents.delegation_config`.
 *
 * Total: anything unparseable falls back to the default rather than throwing,
 * because a malformed blob must not be able to stop an agent from running - and
 * must equally not be able to lift a limit.
 */
export const delegationConfigSchema = z
  .object({
    maxDepth: clamped("maxDepth", 1).default(DELEGATION_DEFAULTS.maxDepth),
    maxDelegations: clamped("maxDelegations", 1).default(DELEGATION_DEFAULTS.maxDelegations),
    timeoutMs: clamped("timeoutMs", 5_000).default(DELEGATION_DEFAULTS.timeoutMs),
    tokenBudget: clamped("tokenBudget", 1_000).default(DELEGATION_DEFAULTS.tokenBudget),
  })
  .catch(() => ({ ...DELEGATION_DEFAULTS }));

export function parseDelegationConfig(value: unknown): DelegationConfig {
  return delegationConfigSchema.parse(value ?? {});
}

/** Form-facing schema for the supervisor tab. Same ceilings, reported as errors. */
export const delegationConfigFormSchema = z.object({
  maxDepth: z
    .number({ error: "Enter a number" })
    .int()
    .min(1, { error: "Minimum is 1" })
    .max(DELEGATION_CEILINGS.maxDepth, { error: `Maximum is ${DELEGATION_CEILINGS.maxDepth}` }),
  maxDelegations: z
    .number({ error: "Enter a number" })
    .int()
    .min(1, { error: "Minimum is 1" })
    .max(DELEGATION_CEILINGS.maxDelegations, { error: `Maximum is ${DELEGATION_CEILINGS.maxDelegations}` }),
  timeoutMs: z
    .number({ error: "Enter a number" })
    .int()
    .min(5_000, { error: "Minimum is 5000" })
    .max(DELEGATION_CEILINGS.timeoutMs, { error: `Maximum is ${DELEGATION_CEILINGS.timeoutMs}` }),
  tokenBudget: z
    .number({ error: "Enter a number" })
    .int()
    .min(1_000, { error: "Minimum is 1000" })
    .max(DELEGATION_CEILINGS.tokenBudget, { error: `Maximum is ${DELEGATION_CEILINGS.tokenBudget}` }),
});

export type DelegationConfigFormValues = z.infer<typeof delegationConfigFormSchema>;
