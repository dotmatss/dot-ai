import "server-only";

import { Client, StreamableHTTPClientTransport, type AuthProvider } from "@modelcontextprotocol/client";

import { MCP_DEFAULT_CREDENTIAL_HEADER, MCP_LIMITS, MCP_PROTOCOL_REVISION } from "@/features/mcp/constants";
import { validateTools, type ValidatedTools } from "@/features/mcp/server/tool-validation";
import { createGuardedFetch, EgressBlockedError } from "@/server/http/egress-guard";
import { siteConfig } from "@/config/site";

/**
 * The only module in the application that imports the MCP SDK.
 *
 * Everything above it speaks in our own domain types, so the protocol cannot
 * leak into the agent runtime, the workflow engine or the UI, and a protocol
 * revision lands here rather than everywhere.
 *
 * ## Why the SDK rather than raw fetch
 *
 * Revision 2026-07-28 requires `MCP-Protocol-Version`, `Mcp-Method` and
 * `Mcp-Name` headers that must agree with the body or the server returns
 * `-32020 HeaderMismatch`, plus per-request `_meta`, pagination, version
 * negotiation with fallback to the older initialize-based era, and the
 * `InputRequiredResult` round-trip shape. That is a moving conformance
 * surface, not a convenience.
 *
 * ## Why this is still safe
 *
 * The transport takes a `fetch` option, documented as being used for all
 * network requests, so our egress guard sits *inside* the SDK's request path:
 * scheme and port policy, DNS resolution checked against the private-address
 * policy, manual redirects re-checked per hop, one wall-clock budget, and a
 * response size cap. The SDK never reaches the network on its own terms.
 *
 * ## Streamable HTTP only
 *
 * `stdio` is a separate subpath export of this package (`.../client/stdio`)
 * and is never imported. `tests/unit/mcp-isolation.test.ts` walks the import
 * graph and fails if it ever is, because a stdio transport would mean
 * launching a subprocess from customer configuration.
 */

export type McpClientFailure =
  | { kind: "blocked"; message: string }
  | { kind: "unauthorized"; message: string }
  /**
   * The server understood us and said no. `requiredScope` is present when it
   * answered `insufficient_scope`, which is the specification's way of asking
   * for a step-up authorization rather than a retry.
   */
  | { kind: "forbidden"; message: string; requiredScope: string | null }
  | { kind: "protocol"; message: string }
  | { kind: "unreachable"; message: string };

export type McpDiscoveryResult = { ok: true; discovered: ValidatedTools } | { ok: false; failure: McpClientFailure };

export interface McpConnectionConfig {
  endpointUrl: string;
  /** Header the credential travels in. Null when the server needs none. */
  credentialHeader: string | null;
  /** The plaintext credential, already opened from the secret box. */
  credential: string | null;
}

/**
 * Classifies a thrown error without leaking anything sensitive.
 *
 * The message we keep names the host and the condition. It never contains the
 * endpoint URL (which can itself be a credential), the credential, or a
 * response body.
 */
function classify(error: unknown): McpClientFailure {
  if (error instanceof EgressBlockedError) return { kind: "blocked", message: error.message };

  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "The request failed.";

  // Checked before the 401 case: an insufficient_scope response is a 403 that
  // often carries the word "unauthorized" as well, and treating it as a bad
  // credential would send somebody off to re-enter one that is perfectly fine.
  if (/insufficient_scope/i.test(message)) {
    const scope = /scope\s*=\s*"([^"]+)"/i.exec(message)?.[1] ?? null;
    return {
      kind: "forbidden",
      message: scope
        ? "The server needs wider access than this authorization grants."
        : "The server refused the call as outside what this authorization allows.",
      requiredScope: scope,
    };
  }
  if (name === "UnauthorizedError" || /\b401\b|unauthor/i.test(message)) {
    return { kind: "unauthorized", message: "The server rejected our credential." };
  }
  if (name === "AbortError" || /abort|timed? ?out/i.test(message)) {
    return { kind: "unreachable", message: `The server did not respond within ${MCP_LIMITS.requestTimeoutMs / 1000} seconds.` };
  }
  if (/HeaderMismatch|-32020|protocol|UnsupportedProtocolVersion|JSON-?RPC/i.test(message)) {
    return { kind: "protocol", message: "The server did not answer with a protocol version we support." };
  }
  return { kind: "unreachable", message: "The server could not be reached." };
}

/**
 * Bearer credentials go through the SDK's `AuthProvider` rather than a raw
 * header, because that path also gives us the specification's 401 handling.
 * A non-standard header name has no such path and is set directly.
 */
function authFor(config: McpConnectionConfig): { authProvider?: AuthProvider; headers: Record<string, string> } {
  if (!config.credential || !config.credentialHeader) return { headers: {} };

  const header = config.credentialHeader.trim();
  if (header.toLowerCase() === MCP_DEFAULT_CREDENTIAL_HEADER.toLowerCase()) {
    const token = config.credential;
    return { authProvider: { token: async () => token }, headers: {} };
  }
  return { headers: { [header]: config.credential } };
}

async function withClient<T>(
  config: McpConnectionConfig,
  signal: AbortSignal | undefined,
  run: (client: Client) => Promise<T>,
  /** Per-request wall-clock budget. A call gets longer than a discovery. */
  timeoutMs: number = MCP_LIMITS.requestTimeoutMs,
): Promise<T> {
  const { authProvider, headers } = authFor(config);

  const transport = new StreamableHTTPClientTransport(new URL(config.endpointUrl), {
    fetch: createGuardedFetch({ timeoutMs }),
    ...(authProvider ? { authProvider } : {}),
    requestInit: { headers, signal },
  });

  const client = new Client({ name: `${siteConfig.name}-mcp-client`, version: MCP_PROTOCOL_REVISION });

  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    // Always released: the transport holds a socket, and an agent turn that
    // throws must not leak one per failed call.
    await client.close().catch(() => undefined);
  }
}

/**
 * Reads the tool list, following pagination.
 *
 * The page cap is a defence, not a convenience: a server whose `nextCursor`
 * never terminates would otherwise loop until the timeout, and the
 * specification puts no bound on it.
 */
export async function discoverTools(config: McpConnectionConfig, signal?: AbortSignal): Promise<McpDiscoveryResult> {
  try {
    const raw = await withClient(config, signal, async (client) => {
      const collected: unknown[] = [];
      let cursor: string | undefined;

      for (let page = 0; page < MCP_LIMITS.maxDiscoveryPages; page++) {
        const result = await client.listTools(cursor ? { cursor } : undefined);
        collected.push(...(Array.isArray(result.tools) ? result.tools : []));
        const next = (result as { nextCursor?: unknown }).nextCursor;
        if (typeof next !== "string" || next.length === 0) break;
        if (collected.length >= MCP_LIMITS.maxToolsPerServer) break;
        cursor = next;
      }
      return collected;
    });

    return { ok: true, discovered: validateTools(raw) };
  } catch (error) {
    return { ok: false, failure: classify(error) };
  }
}

/** What a tool call produced, already bounded and flattened for our use. */
export interface McpToolCallOutput {
  /** Text rendering of the content blocks. Bounded, and never re-interpreted. */
  text: string;
  /** The server's own error flag. A tool may fail without the call failing. */
  isError: boolean;
  /** `structuredContent` when the server sent it, bounded by the same cap. */
  structured: unknown | null;
  /** Serialised size of the whole result before truncation. */
  bytes: number;
  truncated: boolean;
}

export type McpToolCallResult = { ok: true; output: McpToolCallOutput } | { ok: false; failure: McpClientFailure };

/**
 * Renders content blocks as text for a model.
 *
 * Binary blocks are described rather than inlined: a base64 image in a prompt
 * costs a fortune and tells the model nothing. Unknown block types are named
 * rather than dropped, so a result is never silently half-reported.
 */
function renderContent(content: unknown): string {
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const entry = block as Record<string, unknown>;

    if (entry.type === "text" && typeof entry.text === "string") {
      parts.push(entry.text);
      continue;
    }
    if (entry.type === "image" || entry.type === "audio") {
      const mime = typeof entry.mimeType === "string" ? entry.mimeType : "unknown type";
      const size = typeof entry.data === "string" ? Math.ceil((entry.data.length * 3) / 4) : 0;
      parts.push(`[${String(entry.type)} omitted: ${mime}, ${size} bytes]`);
      continue;
    }
    if (entry.type === "resource_link") {
      const uri = typeof entry.uri === "string" ? entry.uri : "no uri";
      parts.push(`[resource link: ${uri}]`);
      continue;
    }
    if (entry.type === "resource") {
      const resource = entry.resource as Record<string, unknown> | undefined;
      const text = resource && typeof resource.text === "string" ? resource.text : null;
      const uri = resource && typeof resource.uri === "string" ? resource.uri : "no uri";
      parts.push(text ?? `[embedded resource: ${uri}]`);
      continue;
    }
    parts.push(`[unsupported content block: ${typeof entry.type === "string" ? entry.type : "unnamed"}]`);
  }
  return parts.join("\n");
}

function serialisedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return 0;
  }
}

export interface McpToolCallInput {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Calls one tool.
 *
 * Authorization is *not* decided here. By the time this runs, the grant, the
 * content-hash pin and the approval requirement have all been checked against
 * freshly read rows; this module's only job is the protocol and the bounds.
 */
export async function callTool(
  config: McpConnectionConfig,
  input: McpToolCallInput,
  signal?: AbortSignal,
): Promise<McpToolCallResult> {
  try {
    const raw = await withClient(
      config,
      signal,
      (client) => client.callTool({ name: input.name, arguments: input.arguments }),
      MCP_LIMITS.callTimeoutMs,
    );

    const result = (raw ?? {}) as Record<string, unknown>;
    const bytes = serialisedBytes(result);

    const rendered = renderContent(result.content);
    const truncated = rendered.length > MCP_LIMITS.maxResultTextLength || bytes > MCP_LIMITS.maxResultBytes;
    const text = truncated ? `${rendered.slice(0, MCP_LIMITS.maxResultTextLength)}\n[result truncated]` : rendered;

    return {
      ok: true,
      output: {
        text,
        isError: result.isError === true,
        structured: bytes <= MCP_LIMITS.maxResultBytes ? (result.structuredContent ?? null) : null,
        bytes,
        truncated,
      },
    };
  } catch (error) {
    return { ok: false, failure: classify(error) };
  }
}

export type McpProbeResult =
  | { ok: true; toolCount: number; message: string }
  | { ok: false; failure: McpClientFailure };

/**
 * Checks that a configured server answers, and how many tools it offers.
 *
 * There is no "connect" to test: the protocol has no sessions, so a probe is
 * simply a real `tools/list`. That is also the honest thing to test, because
 * it is what discovery and every later call will do.
 */
export async function probeServer(config: McpConnectionConfig, signal?: AbortSignal): Promise<McpProbeResult> {
  const result = await discoverTools(config, signal);
  if (!result.ok) return { ok: false, failure: result.failure };

  const { tools, rejected, truncated } = result.discovered;
  const parts = [`${tools.length} tool${tools.length === 1 ? "" : "s"} available`];
  if (rejected.length > 0) parts.push(`${rejected.length} skipped as unusable`);
  if (truncated) parts.push(`list truncated at ${MCP_LIMITS.maxToolsPerServer}`);

  return { ok: true, toolCount: tools.length, message: parts.join(", ") };
}
