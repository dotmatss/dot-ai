// @vitest-environment node
/**
 * The `tool.http_request` credential seam, in the pure workflow engine.
 *
 * The engine never opens a credential itself: it calls an injected
 * `resolveCredential`, the way it calls an injected gateway and runner. What
 * these tests pin down is the contract around that seam, and one property in
 * particular that is the whole reason the feature exists:
 *
 *   THE VALUE MUST NOT REACH THE STEP OUTPUT. A run's steps are written to the
 *   run row and returned to the browser. A credential that appeared there would
 *   be no better protected than the plaintext header it replaced - worse, in
 *   fact, because it would look safe.
 *
 * The rest: a definition that names a credential refuses to start when no
 * resolver was provided (before its first step, not at the step), a deleted
 * credential fails the step rather than sending an unauthenticated request, and
 * a simulated step never resolves anything at all.
 */
import { describe, expect, it, vi } from "vitest";

import type { WorkflowDefinition } from "@/features/workflows/domain/definition";
import {
  executeDefinition,
  type WorkflowAiGateway,
  type WorkflowCredentialResolver,
} from "@/features/workflows/domain/execution";

const untouchedGateway: WorkflowAiGateway = {
  provider: "stub",
  async *streamChat() {
    throw new Error("the workflow gateway must not be used by an http step");
  },
};

const neverFetch = (() => {
  throw new Error("fetch must not be called");
}) as unknown as typeof fetch;

const CREDENTIAL = "11111111-1111-4111-8111-111111111111";
const DELETED = "22222222-2222-4222-8222-222222222222";
const SECRET = "sk_live_do_not_leak_me";

/** Captures what the step actually put on the wire. */
function recordingFetch(): { fetchImpl: typeof fetch; calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...((init?.headers ?? {}) as Record<string, string>) } });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function stubResolver(): { resolveCredential: WorkflowCredentialResolver; calls: string[] } {
  const calls: string[] = [];
  const resolveCredential: WorkflowCredentialResolver = vi.fn(async (credentialId) => {
    calls.push(credentialId);
    if (credentialId !== CREDENTIAL) return null;
    return { name: "Stripe (production)", headerName: "Authorization", headerValue: `Bearer ${SECRET}` };
  });
  return { resolveCredential, calls };
}

const trigger = { id: "start", type: "trigger.manual" as const, label: "Start", config: { note: "" } };
const edge = (from: string, to: string) => ({ id: `${from}-${to}`, from, to });

function httpDefinition(config: Record<string, unknown>): WorkflowDefinition {
  return {
    nodes: [
      trigger,
      {
        id: "call",
        type: "tool.http_request",
        label: "Call the API",
        config: {
          url: "https://api.example.com/charge",
          method: "POST",
          headers: {},
          bodyTemplate: "",
          credentialId: "",
          allowOutbound: true,
          allowedHosts: ["api.example.com"],
          timeoutMs: 5000,
          ...config,
        },
      },
    ],
    edges: [edge("start", "call")],
  };
}

describe("tool.http_request — sending a credential", () => {
  it("sets the credential's header on the request", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const { resolveCredential } = stubResolver();

    const result = await executeDefinition({
      definition: httpDefinition({ credentialId: CREDENTIAL }),
      gateway: untouchedGateway,
      fetchImpl,
      resolveCredential,
    });

    expect(result.status).toBe("succeeded");
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("never puts the value in the step output, whatever the header is called", async () => {
    const { fetchImpl } = recordingFetch();
    // A custom header name defeats a name-based redaction list, which is
    // exactly why the credential is merged after the summary is built rather
    // than redacted out of it.
    const resolveCredential: WorkflowCredentialResolver = async () => ({
      name: "Acme",
      headerName: "X-Totally-Innocent",
      headerValue: SECRET,
    });

    const result = await executeDefinition({
      definition: httpDefinition({ credentialId: CREDENTIAL }),
      gateway: untouchedGateway,
      fetchImpl,
      resolveCredential,
    });

    expect(result.status).toBe("succeeded");
    // The whole serialized run, not just the headers object: the value must not
    // appear anywhere a run row or an API response would carry it.
    expect(JSON.stringify(result)).not.toContain(SECRET);
    const output = result.steps[1]?.output as Record<string, unknown>;
    expect(output.headers).toEqual({});
    // The credential is named, so the timeline still says how the call
    // authenticated.
    expect(output.credential).toBe("Acme");
  });

  it("wins over a header of the same name typed into the step", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const { resolveCredential } = stubResolver();

    const result = await executeDefinition({
      definition: httpDefinition({
        credentialId: CREDENTIAL,
        headers: { Authorization: "Bearer stale-value-from-the-definition" },
      }),
      gateway: untouchedGateway,
      fetchImpl,
      resolveCredential,
    });

    expect(result.status).toBe("succeeded");
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("sends nothing extra when the step names no credential", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const { resolveCredential, calls: resolved } = stubResolver();

    const result = await executeDefinition({
      definition: httpDefinition({ headers: { "X-Trace": "abc" } }),
      gateway: untouchedGateway,
      fetchImpl,
      resolveCredential,
    });

    expect(result.status).toBe("succeeded");
    expect(calls[0]?.headers).toEqual({ "X-Trace": "abc" });
    expect(resolved).toEqual([]);
    expect((result.steps[1]?.output as Record<string, unknown>).credential).toBeNull();
  });
});

describe("tool.http_request — when a credential cannot be used", () => {
  it("fails the step rather than sending an unauthenticated request", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const { resolveCredential } = stubResolver();

    const result = await executeDefinition({
      definition: httpDefinition({ credentialId: DELETED }),
      gateway: untouchedGateway,
      fetchImpl,
      resolveCredential,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("no longer available");
    // The request was never made: a step that cannot authenticate must not
    // reach the destination at all.
    expect(calls).toEqual([]);
  });

  it("refuses to start when the engine has no resolver, before the first step", async () => {
    const result = await executeDefinition({
      definition: httpDefinition({ credentialId: CREDENTIAL }),
      gateway: untouchedGateway,
      fetchImpl: neverFetch,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("not available in this context");
    // Nothing ran: an earlier action step in a longer workflow may have side
    // effects, so the refusal has to come before the walk begins.
    expect(result.steps).toEqual([]);
  });

  it("lets a definition with no credential run without a resolver", async () => {
    const { fetchImpl } = recordingFetch();
    const result = await executeDefinition({
      definition: httpDefinition({}),
      gateway: untouchedGateway,
      fetchImpl,
    });
    expect(result.status).toBe("succeeded");
  });
});

describe("tool.http_request — simulated steps", () => {
  it("does not resolve a credential when outbound requests are off", async () => {
    const { resolveCredential, calls } = stubResolver();

    const result = await executeDefinition({
      definition: httpDefinition({ credentialId: CREDENTIAL, allowOutbound: false }),
      gateway: untouchedGateway,
      fetchImpl: neverFetch,
      resolveCredential,
    });

    expect(result.status).toBe("succeeded");
    // Nothing was sent, so nothing was decrypted: a dry run must not touch
    // secret material at all.
    expect(calls).toEqual([]);
    const output = result.steps[1]?.output as Record<string, unknown>;
    expect(output.simulated).toBe(true);
    // The reference, not a name and certainly not a value.
    expect(output.credential).toBe(CREDENTIAL);
  });

  it("does not resolve a credential when the host is not allowlisted", async () => {
    const { resolveCredential, calls } = stubResolver();

    const result = await executeDefinition({
      definition: httpDefinition({ credentialId: CREDENTIAL, allowedHosts: ["other.example.com"] }),
      gateway: untouchedGateway,
      fetchImpl: neverFetch,
      resolveCredential,
    });

    expect(result.status).toBe("failed");
    // The egress check runs first, so a blocked destination never gets as far
    // as opening the credential.
    expect(calls).toEqual([]);
  });
});
