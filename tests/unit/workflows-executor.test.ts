import { describe, expect, it, vi } from "vitest";

import type { WorkflowDefinition } from "@/features/workflows/domain/definition";
import { executeDefinition, type WorkflowAiGateway } from "@/features/workflows/domain/execution";
import { NODE_TYPES } from "@/features/workflows/domain/node-types";
import { templateDefinition } from "@/features/workflows/domain/templates";
import type { ChatMessage, ChatStreamEvent } from "@/types/ai";

/** Records the requests it receives and replies with canned text. */
function stubGateway(reply: string, options: { fail?: string } = {}) {
  const requests: ChatMessage[][] = [];
  const gateway: WorkflowAiGateway = {
    provider: "stub",
    async *streamChat(request): AsyncGenerator<ChatStreamEvent> {
      requests.push(request.messages);
      yield { type: "start", id: "stub", model: request.model ?? "stub-1" };
      if (options.fail) {
        yield { type: "error", message: options.fail };
        return;
      }
      for (const word of reply.split(" ")) {
        yield { type: "text-delta", delta: `${word} ` };
      }
      yield { type: "usage", usage: { inputTokens: 11, outputTokens: 4 } };
      yield { type: "done", finishReason: "stop" };
    },
  };
  return { gateway, requests };
}

const neverFetch = (() => {
  throw new Error("fetch must not be called");
}) as unknown as typeof fetch;

function definitionOf(nodes: WorkflowDefinition["nodes"], edges: WorkflowDefinition["edges"]): WorkflowDefinition {
  return { nodes, edges };
}

describe("executeDefinition — happy path", () => {
  it("walks the FAQ template and returns the response as run output", async () => {
    const { gateway, requests } = stubGateway("Our pricing starts at ten dollars.");
    const result = await executeDefinition({
      definition: templateDefinition("faq_responder"),
      gateway,
      trigger: { kind: "conversation", message: "How much does it cost?" },
      fetchImpl: neverFetch,
    });

    expect(result.status).toBe("succeeded");
    expect(result.steps.map((step) => step.nodeId)).toEqual(["conversation", "answer", "respond"]);
    expect(result.steps.every((step) => step.status === "succeeded")).toBe(true);
    expect(result.output).toEqual({ message: "Our pricing starts at ten dollars." });
    expect(result.usage).toEqual({ aiCalls: 1, inputTokens: 11, outputTokens: 4 });
    expect(result.error).toBeNull();

    // The prompt template was rendered against the trigger payload.
    expect(requests[0]?.at(-1)?.content).toContain("How much does it cost?");
    const aiStep = result.steps[1];
    expect(aiStep && aiStep.startedAt <= aiStep.finishedAt).toBe(true);
  });

  it("records step output under the node id so later templates can read it", async () => {
    const { gateway } = stubGateway("qualified");
    const result = await executeDefinition({
      definition: templateDefinition("faq_responder"),
      gateway,
      trigger: { message: "hi" },
      fetchImpl: neverFetch,
    });
    expect(result.context.nodes.answer).toMatchObject({ text: "qualified" });
    expect(result.context.vars).toMatchObject({ answer: "qualified" });
  });
});

describe("executeDefinition — branching", () => {
  const lead = () => templateDefinition("lead_qualification");

  it("takes the true outcome and runs the action step", async () => {
    const { gateway } = stubGateway("qualified");
    const result = await executeDefinition({
      definition: lead(),
      gateway,
      trigger: { message: "We need 20 seats for Acme", email: "ada@example.com" },
      fetchImpl: neverFetch,
    });
    expect(result.status).toBe("succeeded");
    expect(result.steps.map((step) => step.nodeId)).toEqual(["conversation", "classify", "branch", "create_contact", "respond"]);
    expect(result.steps[2]?.output).toMatchObject({ result: true, left: "qualified", right: "qualified" });
    // Actions never touch external systems in this release.
    expect(result.steps[3]?.output).toMatchObject({ simulated: true });
  });

  it("takes the otherwise outcome when the classification does not match", async () => {
    const { gateway } = stubGateway("not_qualified");
    const result = await executeDefinition({
      definition: lead(),
      gateway,
      trigger: { message: "just browsing" },
      fetchImpl: neverFetch,
    });
    expect(result.steps.map((step) => step.nodeId)).toEqual(["conversation", "classify", "branch", "nurture"]);
    expect(result.status).toBe("succeeded");
  });

  it("falls back to the configured category when the model answers something else", async () => {
    const { gateway } = stubGateway("I am not sure about this one");
    const result = await executeDefinition({
      definition: lead(),
      gateway,
      trigger: { message: "hello" },
      fetchImpl: neverFetch,
    });
    expect(result.steps[1]?.output).toMatchObject({ category: "not_qualified", matched: false });
  });
});

describe("executeDefinition — failures", () => {
  it("fails the run at the failing step and stops", async () => {
    const { gateway } = stubGateway("", { fail: "Upstream model unavailable" });
    const result = await executeDefinition({
      definition: templateDefinition("faq_responder"),
      gateway,
      trigger: { message: "hi" },
      fetchImpl: neverFetch,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Upstream model unavailable");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1]).toMatchObject({ nodeId: "answer", status: "failed", error: "Upstream model unavailable" });
    expect(result.output).toBeNull();
  });

  it("refuses to run a definition that does not validate", async () => {
    const { gateway } = stubGateway("hello");
    const result = await executeDefinition({ definition: { nodes: [], edges: [] }, gateway, fetchImpl: neverFetch });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("no steps");
    expect(result.steps).toHaveLength(0);
  });

  it("fails when a required input value is missing", async () => {
    const { gateway } = stubGateway("hello");
    const definition = definitionOf(
      [
        { id: "trigger", type: "trigger.manual", label: "Start", config: { note: "" } },
        { id: "collect", type: "input.form", label: "Collect", config: { title: "Lead", fields: ["email", "company"] } },
        { id: "respond", type: "output.respond", label: "Reply", config: { message: "ok" } },
      ],
      [
        { id: "e1", from: "trigger", to: "collect" },
        { id: "e2", from: "collect", to: "respond" },
      ],
    );
    const result = await executeDefinition({
      definition,
      gateway,
      input: { email: "ada@example.com" },
      fetchImpl: neverFetch,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("company");
    expect(result.steps).toHaveLength(2);
  });
});

describe("executeDefinition — tool safety", () => {
  function httpDefinition(config: Record<string, unknown>): WorkflowDefinition {
    return definitionOf(
      [
        { id: "trigger", type: "trigger.manual", label: "Start", config: { note: "" } },
        {
          id: "call",
          type: "tool.http_request",
          label: "Call the API",
          config: { ...structuredClone(NODE_TYPES["tool.http_request"].defaultConfig), ...config },
        },
        { id: "respond", type: "output.respond", label: "Reply", config: { message: "done" } },
      ],
      [
        { id: "e1", from: "trigger", to: "call" },
        { id: "e2", from: "call", to: "respond" },
      ],
    );
  }

  it("simulates the request by default and never calls fetch", async () => {
    const { gateway } = stubGateway("hi");
    const fetchSpy = vi.fn();
    const result = await executeDefinition({
      definition: httpDefinition({ url: "https://api.example.com/hook", bodyTemplate: '{"note":"{{input.note}}"}' }),
      gateway,
      input: { note: "hello" },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.status).toBe("succeeded");
    expect(result.steps[1]?.output).toMatchObject({ simulated: true, method: "POST", body: '{"note":"hello"}' });
  });

  it("redacts credential-like headers from the recorded step", async () => {
    const { gateway } = stubGateway("hi");
    const result = await executeDefinition({
      definition: httpDefinition({ headers: { Authorization: "Bearer secret-token", Accept: "application/json" } }),
      gateway,
      fetchImpl: neverFetch,
    });
    expect(result.steps[1]?.output).toMatchObject({
      headers: { Authorization: "«redacted»", Accept: "application/json" },
    });
  });

  it("refuses a private host even when outbound requests are allowed", async () => {
    const { gateway } = stubGateway("hi");
    const fetchSpy = vi.fn();
    const result = await executeDefinition({
      definition: httpDefinition({
        url: "http://169.254.169.254/latest/meta-data",
        allowOutbound: true,
        allowedHosts: ["169.254.169.254"],
      }),
      gateway,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.error).toContain("private");
    expect(result.steps[1]?.status).toBe("failed");
  });

  it("refuses a host that is not on the step allowlist", async () => {
    const { gateway } = stubGateway("hi");
    const fetchSpy = vi.fn();
    const result = await executeDefinition({
      definition: httpDefinition({ url: "https://evil.example.org/x", allowOutbound: true, allowedHosts: ["api.example.com"] }),
      gateway,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.error).toContain("allowlist");
  });

  it("performs an allowed request and records the response", async () => {
    const { gateway } = stubGateway("hi");
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const result = await executeDefinition({
      definition: httpDefinition({
        url: "https://api.example.com/hook",
        allowOutbound: true,
        allowedHosts: ["*.example.com"],
      }),
      gateway,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("succeeded");
    expect(result.steps[1]?.output).toMatchObject({ simulated: false, status: 200, ok: true, body: { received: true } });
  });

  it("fails the step when the response is an error status", async () => {
    const { gateway } = stubGateway("hi");
    const fetchSpy = vi.fn(async () => new Response("nope", { status: 503 }));
    const result = await executeDefinition({
      definition: httpDefinition({ url: "https://api.example.com/hook", allowOutbound: true, allowedHosts: ["api.example.com"] }),
      gateway,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("503");
    expect(result.steps[1]?.output).toMatchObject({ status: 503, ok: false });
  });
});
