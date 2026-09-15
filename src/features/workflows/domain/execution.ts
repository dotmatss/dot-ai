import {
  definitionErrors,
  findTriggerNode,
  validateDefinition,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from "@/features/workflows/domain/definition";
import { defaultOutgoingEdges, outgoingEdges } from "@/features/workflows/domain/graph";
import {
  aiClassifyConfigSchema,
  agentRunConfigSchema,
  aiGenerateConfigSchema,
  branchConfigSchema,
  conversationTriggerConfigSchema,
  createContactConfigSchema,
  formInputConfigSchema,
  httpRequestConfigSchema,
  isBranchType,
  manualTriggerConfigSchema,
  respondConfigSchema,
  sendNotificationConfigSchema,
  webhookTriggerConfigSchema,
} from "@/features/workflows/domain/node-types";
import { checkOutboundUrl } from "@/features/workflows/domain/outbound";
import { createRunContext, evaluateCondition, renderTemplate, type RunContext } from "@/features/workflows/domain/variables";
import type { WorkflowRunStep } from "@/features/workflows/types";
import type { ChatMessage, ChatStreamEvent } from "@/types/ai";
import type { z } from "zod";

/**
 * Sequential workflow engine.
 *
 * It is deliberately free of persistence and of `getAiGateway()`: the gateway,
 * the clock and `fetch` are parameters, so the whole engine is unit-testable
 * with stubs and the server executor stays a thin persistence wrapper around
 * it. Side effects are conservative by default — tool and action steps are
 * simulated unless a step explicitly opts in — because a workflow definition
 * is authored data that runs on our servers.
 */

/** Structural subset of `AiGateway` the engine needs; keeps stubs trivial. */
export interface WorkflowAiGateway {
  readonly provider?: string;
  streamChat(request: {
    model?: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncIterable<ChatStreamEvent>;
}

export interface ExecutionUsage {
  aiCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ExecutionResult {
  status: "succeeded" | "failed";
  steps: WorkflowRunStep[];
  output: Record<string, unknown> | null;
  error: string | null;
  usage: ExecutionUsage;
  /** Final run context, useful for debugging a run and for tests. */
  context: RunContext;
}

/**
 * What an `agent.run` step needs back. A structural subset of the agents
 * feature's `AgentExecutionResult`, declared here for the same reason
 * `WorkflowAiGateway` is: the engine stays a leaf that any caller can satisfy
 * with a stub, and a change to the agents feature cannot silently widen what a
 * workflow step is allowed to see.
 */
export interface WorkflowAgentResult {
  executionId: string;
  status: "succeeded" | "failed" | "timed_out" | "refused" | "running";
  /** The agent's final answer. Never its prompt, its tool calls or its sources. */
  output: string | null;
  error: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  requiresApproval: boolean;
}

/**
 * Runs one agent to completion. Provided by the server executor, which binds it
 * to the run's workspace and to a tool policy; absent in the pure engine, so a
 * definition that contains an agent step cannot execute anywhere the server
 * did not deliberately allow it.
 */
export type WorkflowAgentRunner = (input: { agentId: string; task: string; signal?: AbortSignal }) => Promise<WorkflowAgentResult>;

/**
 * What an `tool.http_request` step needs to authenticate itself.
 *
 * Declared here as a structural type for the same reason `WorkflowAgentRunner`
 * is: the engine stays a leaf that a test can satisfy with a stub, and it never
 * learns where a credential is stored or how it is encrypted. It receives one
 * header, already assembled.
 *
 * Provided by the server executor, bound to the run's workspace, so a
 * credential id in a definition is resolved through THAT workspace - an id
 * copied in from anywhere else is simply "not available".
 */
export interface WorkflowCredential {
  /** Safe to show in a run timeline. The value behind it is not. */
  name: string;
  headerName: string;
  headerValue: string;
}

/** Returns `null` when the id does not name a credential in the run's workspace. */
export type WorkflowCredentialResolver = (credentialId: string) => Promise<WorkflowCredential | null>;

export interface ExecuteDefinitionOptions {
  definition: WorkflowDefinition;
  gateway: WorkflowAiGateway;
  trigger?: Record<string, unknown>;
  input?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Required only when a `tool.http_request` step names a credential. */
  resolveCredential?: WorkflowCredentialResolver;
  now?: () => Date;
  maxSteps?: number;
  /** Required only when the definition contains an `agent.run` step. */
  runAgent?: WorkflowAgentRunner;
}

export const MAX_RUN_STEPS = 40;
export const MAX_RESPONSE_BYTES = 64 * 1024;
export const MAX_REQUEST_TIMEOUT_MS = 15_000;

const REDACTED = "«redacted»";
const SENSITIVE_HEADER = /authorization|api[-_]?key|token|secret|cookie|password/i;

/** Failure that still has something worth showing in the run timeline. */
class NodeExecutionError extends Error {
  readonly output: Record<string, unknown> | null;

  constructor(message: string, output: Record<string, unknown> | null = null) {
    super(message);
    this.name = "NodeExecutionError";
    this.output = output;
  }
}

interface NodeOutcome {
  output: Record<string, unknown>;
  /** Result of a branch step, selecting the outgoing edge. */
  branch?: boolean;
  /** Values written into `vars` for later steps. */
  vars?: Record<string, unknown>;
  /** Values merged into the run output. */
  runOutput?: Record<string, unknown>;
}

function parseConfig<S extends z.ZodType>(schema: S, node: WorkflowNode): z.output<S> {
  const parsed = schema.safeParse(node.config);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.map(String).join(".");
    throw new NodeExecutionError(
      `Step configuration is invalid${field ? ` (${field})` : ""}: ${issue?.message ?? "unknown error"}`,
    );
  }
  return parsed.data;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "The step failed for an unknown reason.";
}

function pickValues(source: Record<string, unknown>, keys: ReadonlyArray<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  // Step output is returned to the browser and stored in the run row, so header
  // values that look like credentials never leave the server.
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, SENSITIVE_HEADER.test(name) ? REDACTED : value]),
  );
}

async function collectGatewayText(
  gateway: WorkflowAiGateway,
  request: { model?: string; messages: ChatMessage[]; temperature?: number; maxTokens?: number; signal?: AbortSignal },
): Promise<{ text: string; model: string | null; inputTokens: number; outputTokens: number }> {
  let text = "";
  let model: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of gateway.streamChat(request)) {
    switch (event.type) {
      case "start":
        model = event.model;
        break;
      case "text-delta":
        text += event.delta;
        break;
      case "usage":
        inputTokens = event.usage.inputTokens;
        outputTokens = event.usage.outputTokens;
        break;
      case "error":
        throw new NodeExecutionError(event.message);
      case "done":
        if (event.finishReason === "cancelled") throw new NodeExecutionError("The AI request was cancelled.");
        if (event.finishReason === "error") throw new NodeExecutionError("The AI gateway reported an error.");
        break;
      default:
        break;
    }
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) throw new NodeExecutionError("The model returned an empty response.");
  return { text: trimmed, model, inputTokens, outputTokens };
}

async function readCappedText(response: Response, limit: number): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    return { text: text.slice(0, limit), truncated: text.length > limit };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = limit - size;
    if (value.byteLength >= remaining) {
      chunks.push(value.subarray(0, Math.max(0, remaining)));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged), truncated };
}

function classifyAnswer(raw: string, categories: ReadonlyArray<string>, fallback: string): { category: string; matched: boolean } {
  const answer = raw.trim().toLowerCase();
  const exact = categories.find((category) => category.trim().toLowerCase() === answer);
  if (exact) return { category: exact, matched: true };
  const contained = categories.find((category) => answer.includes(category.trim().toLowerCase()));
  if (contained) return { category: contained, matched: true };
  return { category: fallback.trim() || "unmatched", matched: false };
}

interface NodeRunDeps {
  context: RunContext;
  gateway: WorkflowAiGateway;
  usage: ExecutionUsage;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  runAgent?: WorkflowAgentRunner;
  resolveCredential?: WorkflowCredentialResolver;
}

async function runHttpRequest(node: WorkflowNode, deps: NodeRunDeps): Promise<NodeOutcome> {
  const config = parseConfig(httpRequestConfigSchema, node);
  const url = renderTemplate(config.url, deps.context);
  const body = config.bodyTemplate.length > 0 ? renderTemplate(config.bodyTemplate, deps.context) : null;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(config.headers)) {
    headers[name] = renderTemplate(value, deps.context).text;
  }
  const missingVariables = [...new Set([...url.missing, ...(body?.missing ?? [])])];
  // Built from the step's OWN headers only. A resolved credential is merged
  // into the outgoing request further down and never into this object, which
  // is what is stored on the run row and returned to the browser - so the
  // credential's value cannot reach either, whatever its header is called.
  // `redactHeaders` still applies, because an author can type a token here too.
  const summary = {
    method: config.method,
    url: url.text,
    headers: redactHeaders(headers),
    body: body?.text ?? null,
    // The reference, not the value. Replaced by the credential's name below
    // once the step actually resolves one.
    credential: config.credentialId.length > 0 ? config.credentialId : null,
    missingVariables,
  };

  if (!config.allowOutbound) {
    return {
      output: {
        ...summary,
        simulated: true,
        reason: "Outbound requests are disabled for this step, so nothing was sent.",
      },
    };
  }

  const check = checkOutboundUrl(url.text, config.allowedHosts);
  if (!check.ok) throw new NodeExecutionError(check.reason, { ...summary, simulated: true });

  // Resolved only now: a simulated step must not decrypt anything, and this is
  // the first point at which the request is certainly going to be sent.
  const outboundHeaders = { ...headers };
  if (config.credentialId.length > 0) {
    if (!deps.resolveCredential) {
      throw new NodeExecutionError("Credentials are not available in this context.", { ...summary, simulated: true });
    }
    const credential = await deps.resolveCredential(config.credentialId);
    if (!credential) {
      // Named as configuration rather than as a failure of the destination:
      // the credential was deleted, and that is what the operator must fix.
      throw new NodeExecutionError("The credential for this step is no longer available.", {
        ...summary,
        simulated: true,
      });
    }
    // Last, so it wins over a header of the same name typed into the step. The
    // stored credential is the one an operator can rotate in one place.
    outboundHeaders[credential.headerName] = credential.headerValue;
    summary.credential = credential.name;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = Math.min(config.timeoutMs, MAX_REQUEST_TIMEOUT_MS);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortOuter = () => controller.abort();
  deps.signal?.addEventListener("abort", abortOuter, { once: true });

  try {
    const response = await deps.fetchImpl(check.url, {
      method: config.method,
      headers: outboundHeaders,
      body: config.method === "GET" || config.method === "DELETE" ? undefined : (body?.text ?? undefined),
      // A redirect could point at a private address, which would bypass the
      // egress check, so redirects are surfaced instead of followed.
      redirect: "manual",
      signal: controller.signal,
    });
    const { text, truncated } = await readCappedText(response, MAX_RESPONSE_BYTES);
    const contentType = response.headers.get("content-type") ?? null;
    let parsed: unknown = text;
    if (contentType?.includes("json") && !truncated) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
    }
    const output = {
      ...summary,
      simulated: false,
      status: response.status,
      ok: response.ok,
      contentType,
      truncated,
      body: parsed,
    };
    if (!response.ok) {
      throw new NodeExecutionError(`The request failed with HTTP ${response.status}.`, output);
    }
    return { output };
  } catch (error) {
    if (error instanceof NodeExecutionError) throw error;
    if (timedOut) throw new NodeExecutionError(`The request timed out after ${timeoutMs}ms.`, { ...summary, simulated: false });
    throw new NodeExecutionError(`The request could not be sent: ${errorMessage(error)}`, { ...summary, simulated: false });
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", abortOuter);
  }
}

async function runNode(node: WorkflowNode, deps: NodeRunDeps): Promise<NodeOutcome> {
  switch (node.type) {
    case "trigger.manual": {
      const config = parseConfig(manualTriggerConfigSchema, node);
      return { output: { kind: "manual", note: config.note, payload: deps.context.trigger } };
    }
    case "trigger.webhook": {
      const config = parseConfig(webhookTriggerConfigSchema, node);
      return { output: { kind: "webhook", path: config.path, payload: deps.context.trigger } };
    }
    case "trigger.conversation_started": {
      const config = parseConfig(conversationTriggerConfigSchema, node);
      const message = String(deps.context.trigger.message ?? "");
      const keywordMatched = config.keyword.length === 0 || message.toLowerCase().includes(config.keyword.toLowerCase());
      return { output: { kind: "conversation_started", channel: config.channel, keywordMatched, payload: deps.context.trigger } };
    }
    case "input.form": {
      const config = parseConfig(formInputConfigSchema, node);
      const missing = config.fields.filter((field) => {
        const value = deps.context.input[field];
        return value === undefined || value === null || value === "";
      });
      if (missing.length > 0) {
        throw new NodeExecutionError(`Missing required input: ${missing.join(", ")}.`, {
          title: config.title,
          fields: config.fields,
        });
      }
      return { output: { title: config.title, fields: config.fields, values: pickValues(deps.context.input, config.fields) } };
    }
    case "agent.run": {
      const config = parseConfig(agentRunConfigSchema, node);
      // Both refusals are the step's, not the engine's, so the run timeline
      // shows which step could not proceed and why.
      if (!deps.runAgent) throw new NodeExecutionError("Agent steps cannot run in this context.");
      if (!config.agentId) throw new NodeExecutionError("Choose an agent for this step.");

      const task = renderTemplate(config.task, deps.context);
      const result = await deps.runAgent({ agentId: config.agentId, task: task.text, signal: deps.signal });

      // The agent's tokens are metered by the agent engine against the agent
      // that spent them, so they are NOT added to the run's usage here: one
      // model call, billed once, where it happened. The step keeps a copy so
      // the timeline can show what the agent cost.
      const summary = {
        executionId: result.executionId,
        status: result.status,
        requiresApproval: result.requiresApproval,
        usage: result.usage,
        missingVariables: task.missing,
      };
      if (result.status !== "succeeded" || result.output === null) {
        throw new NodeExecutionError(result.error ?? "The agent could not complete the task.", summary);
      }
      return {
        output: { ...summary, answer: result.output },
        vars: { [config.outputKey]: result.output },
      };
    }
    case "ai.generate": {
      const config = parseConfig(aiGenerateConfigSchema, node);
      const prompt = renderTemplate(config.prompt, deps.context);
      const system = config.system.length > 0 ? renderTemplate(config.system, deps.context) : null;
      const messages: ChatMessage[] = [
        ...(system ? [{ role: "system" as const, content: system.text }] : []),
        { role: "user" as const, content: prompt.text },
      ];
      const result = await collectGatewayText(deps.gateway, {
        model: config.model.length > 0 ? config.model : undefined,
        messages,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        signal: deps.signal,
      });
      deps.usage.aiCalls += 1;
      deps.usage.inputTokens += result.inputTokens;
      deps.usage.outputTokens += result.outputTokens;
      return {
        output: {
          text: result.text,
          model: result.model,
          missingVariables: [...new Set([...prompt.missing, ...(system?.missing ?? [])])],
        },
        vars: { [config.outputKey]: result.text },
      };
    }
    case "ai.classify": {
      const config = parseConfig(aiClassifyConfigSchema, node);
      const input = renderTemplate(config.input, deps.context);
      const instructions = config.instructions.length > 0 ? `\n${config.instructions}` : "";
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: `Classify the text into exactly one category. Reply with the category name only.\nCategories: ${config.categories.join(", ")}.${instructions}`,
        },
        { role: "user", content: input.text },
      ];
      const result = await collectGatewayText(deps.gateway, {
        model: config.model.length > 0 ? config.model : undefined,
        messages,
        temperature: 0,
        maxTokens: 64,
        signal: deps.signal,
      });
      deps.usage.aiCalls += 1;
      deps.usage.inputTokens += result.inputTokens;
      deps.usage.outputTokens += result.outputTokens;
      const { category, matched } = classifyAnswer(result.text, config.categories, config.fallbackCategory);
      return {
        output: { category, matched, raw: result.text, model: result.model, missingVariables: input.missing },
        vars: { [config.outputKey]: category },
      };
    }
    case "condition.branch": {
      const config = parseConfig(branchConfigSchema, node);
      const evaluated = evaluateCondition(config, deps.context);
      return {
        output: {
          result: evaluated.result,
          operator: config.operator,
          left: evaluated.left,
          right: evaluated.right,
          missingVariables: evaluated.missing,
        },
        branch: evaluated.result,
      };
    }
    case "tool.http_request":
      return runHttpRequest(node, deps);
    case "action.create_contact": {
      const config = parseConfig(createContactConfigSchema, node);
      const email = renderTemplate(config.email, deps.context);
      const name = renderTemplate(config.name, deps.context);
      const company = renderTemplate(config.company, deps.context);
      return {
        output: {
          simulated: true,
          reason: "Contact creation is simulated in this release.",
          contact: { email: email.text, name: name.text, company: company.text, stage: config.stage, tags: config.tags },
          missingVariables: [...new Set([...email.missing, ...name.missing, ...company.missing])],
        },
      };
    }
    case "action.send_notification": {
      const config = parseConfig(sendNotificationConfigSchema, node);
      const to = renderTemplate(config.to, deps.context);
      const subject = renderTemplate(config.subject, deps.context);
      const message = renderTemplate(config.message, deps.context);
      return {
        output: {
          simulated: true,
          reason: "Notifications are simulated in this release.",
          channel: config.channel,
          to: to.text,
          subject: subject.text,
          message: message.text,
          missingVariables: [...new Set([...to.missing, ...subject.missing, ...message.missing])],
        },
      };
    }
    case "output.respond": {
      const config = parseConfig(respondConfigSchema, node);
      const message = renderTemplate(config.message, deps.context);
      return {
        output: { message: message.text, missingVariables: message.missing },
        runOutput: { [config.outputKey]: message.text },
      };
    }
  }
}

function nextEdgeFor(definition: WorkflowDefinition, node: WorkflowNode, branch: boolean | undefined): WorkflowEdge | undefined {
  if (isBranchType(node.type)) {
    const outcome = branch ? "true" : "false";
    const edges = outgoingEdges(definition, node.id);
    return edges.find((edge) => edge.condition === outcome) ?? edges.find((edge) => edge.condition === undefined || edge.condition === "default");
  }
  return defaultOutgoingEdges(definition, node.id)[0] ?? outgoingEdges(definition, node.id)[0];
}

/**
 * Walks the graph from the trigger, one step at a time. Every step is wrapped
 * so a single failure fails the run with that step's message and stops rather
 * than leaving the run in an unknown state.
 */
export async function executeDefinition(options: ExecuteDefinitionOptions): Promise<ExecutionResult> {
  const { definition, gateway } = options;
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxSteps = options.maxSteps ?? MAX_RUN_STEPS;
  const context = createRunContext({ trigger: options.trigger ?? {}, input: options.input ?? {} });
  const usage: ExecutionUsage = { aiCalls: 0, inputTokens: 0, outputTokens: 0 };
  const steps: WorkflowRunStep[] = [];
  let output: Record<string, unknown> | null = null;

  const failure = (error: string): ExecutionResult => ({ status: "failed", steps, output, error, usage, context });

  const blocking = definitionErrors(validateDefinition(definition));
  const firstBlocking = blocking[0];
  if (firstBlocking) return failure(firstBlocking.message);

  let current = findTriggerNode(definition);
  if (!current) return failure("This workflow has no trigger step.");

  // Refused before the first step rather than at the agent step, so a run that
  // cannot finish does not start: an earlier action step may have side effects.
  if (!options.runAgent && definition.nodes.some((node) => node.type === "agent.run")) {
    return failure("This workflow runs an agent, which is not available in this context.");
  }
  if (
    !options.resolveCredential &&
    definition.nodes.some(
      (node) => node.type === "tool.http_request" && typeof node.config.credentialId === "string" && node.config.credentialId.length > 0,
    )
  ) {
    return failure("This workflow uses a stored credential, which is not available in this context.");
  }

  const visited = new Set<string>();
  const deps: NodeRunDeps = {
    context,
    gateway,
    usage,
    fetchImpl,
    signal: options.signal,
    runAgent: options.runAgent,
    resolveCredential: options.resolveCredential,
  };

  while (current) {
    if (steps.length >= maxSteps) return failure(`The run stopped after ${maxSteps} steps to avoid an endless loop.`);
    if (visited.has(current.id)) return failure(`The run reached “${current.label}” twice, so it was stopped.`);
    visited.add(current.id);

    const startedAt = now().toISOString();
    let outcome: NodeOutcome;
    try {
      outcome = await runNode(current, deps);
    } catch (error) {
      const failedOutput = error instanceof NodeExecutionError ? error.output : null;
      steps.push({
        nodeId: current.id,
        type: current.type,
        label: current.label,
        status: "failed",
        startedAt,
        finishedAt: now().toISOString(),
        output: failedOutput,
        error: errorMessage(error),
      });
      return failure(errorMessage(error));
    }

    steps.push({
      nodeId: current.id,
      type: current.type,
      label: current.label,
      status: "succeeded",
      startedAt,
      finishedAt: now().toISOString(),
      output: outcome.output,
      error: null,
    });

    context.nodes[current.id] = outcome.output;
    if (outcome.vars) Object.assign(context.vars, outcome.vars);
    if (outcome.runOutput) output = { ...(output ?? {}), ...outcome.runOutput };

    const edge = nextEdgeFor(definition, current, outcome.branch);
    current = edge ? (definition.nodes.find((node) => node.id === edge.to) ?? null) : null;
  }

  return { status: "succeeded", steps, output, error: null, usage, context };
}
