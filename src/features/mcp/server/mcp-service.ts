import "server-only";

import { sealSecret } from "@/features/integrations/server/secret-box";
import { MCP_DEFAULT_CREDENTIAL_HEADER, MCP_LIMITS, approvalIsMandatory } from "@/features/mcp/constants";
import { toToolViews } from "@/features/mcp/grants";
import type { CreateMcpServerInput, SetMcpGrantsInput, UpdateMcpServerInput } from "@/features/mcp/schemas";
import { discoverTools, probeServer, type McpClientFailure } from "@/features/mcp/server/mcp-client";
import { connectionFor, secretContext } from "@/features/mcp/server/mcp-credentials";
import * as repository from "@/features/mcp/server/mcp-repository";
import type { McpServerStatus, McpServerSummary, McpToolView } from "@/features/mcp/types";
import { ApiError } from "@/lib/api/api-error";
import { slugify } from "@/lib/slug";
import { recordActivity } from "@/server/activity/activity-log";
import { withWorkspace } from "@/server/db/client";

/**
 * MCP configuration service.
 *
 * Authorize, apply the rules, then persist — the same order as every other
 * service here. The rules that matter are:
 *
 *  - The workspace id comes from `ctx`, which the route derived from the
 *    session. Nothing in this file reads a workspace or server id from a
 *    request body.
 *  - A credential is sealed with a context of `mcp:{workspaceId}:{serverId}`,
 *    so a ciphertext lifted into another workspace's row fails to open rather
 *    than silently decrypting.
 *  - A credential is never returned. Reads expose `hasCredential` and the
 *    header name; the plaintext leaves this module only to reach the guarded
 *    MCP transport.
 *  - A destructive tool always requires approval. Normalised here, and the
 *    database has a CHECK constraint for the path that forgets.
 */

export interface McpContext {
  workspaceId: string;
  userId: string;
}

/** Maps a client failure onto the server status it should be recorded as. */
function statusFor(failure: McpClientFailure): McpServerStatus {
  // `forbidden` is an authorization problem too: the credential is real but
  // does not carry enough, and the fix is to authorize again rather than to
  // check the endpoint.
  return failure.kind === "unauthorized" || failure.kind === "forbidden" ? "unauthorized" : "error";
}

async function uniqueSlug(workspaceId: string, name: string): Promise<string> {
  const root = slugify(name) || "mcp-server";
  let candidate = root;
  for (let attempt = 2; await repository.slugExists(workspaceId, candidate); attempt++) {
    candidate = `${root}-${attempt}`;
    if (attempt > 50) throw ApiError.conflict("Could not derive a unique name for that server.");
  }
  return candidate;
}

export async function listMcpServers(ctx: McpContext): Promise<McpServerSummary[]> {
  const servers = await repository.listServers(ctx.workspaceId);
  return servers.map(repository.toSummary);
}

export async function getMcpServer(ctx: McpContext, serverId: string): Promise<McpServerSummary> {
  const server = await repository.findServerById(ctx.workspaceId, serverId);
  // Not found rather than forbidden: an id belonging to another workspace must
  // be indistinguishable from one that does not exist.
  if (!server) throw ApiError.notFound("MCP server not found");
  return repository.toSummary(server);
}

export async function createMcpServer(ctx: McpContext, input: CreateMcpServerInput): Promise<McpServerSummary> {
  const existing = await repository.countServers(ctx.workspaceId);
  if (existing >= MCP_LIMITS.maxServersPerWorkspace) {
    throw ApiError.badRequest(`A workspace can connect up to ${MCP_LIMITS.maxServersPerWorkspace} MCP servers.`);
  }

  const slug = await uniqueSlug(ctx.workspaceId, input.name);

  const serverId = await withWorkspace(ctx.workspaceId, async (client) => {
    const id = await repository.insertServer(
      {
        workspaceId: ctx.workspaceId,
        createdBy: ctx.userId,
        name: input.name,
        slug,
        endpointUrl: input.endpointUrl,
        authKind: input.authKind,
      },
      client,
    );

    if (input.authKind === "header" && input.credential) {
      const header = input.credentialHeader ?? MCP_DEFAULT_CREDENTIAL_HEADER;
      await repository.upsertServerSecret(
        ctx.workspaceId,
        id,
        sealSecret(input.credential, secretContext(ctx.workspaceId, id)),
        header,
        client,
      );
    }

    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "mcp_server",
        entityId: id,
        action: "created",
        // The endpoint is deliberately absent: it can carry a token in its path.
        summary: `Connected MCP server “${input.name}”`,
      },
      client,
    );

    return id;
  });

  return getMcpServer(ctx, serverId);
}

export async function updateMcpServer(ctx: McpContext, serverId: string, input: UpdateMcpServerInput): Promise<McpServerSummary> {
  const server = await repository.findServerById(ctx.workspaceId, serverId);
  if (!server) throw ApiError.notFound("MCP server not found");

  await withWorkspace(ctx.workspaceId, async (client) => {
    const status: McpServerStatus | undefined =
      input.disabled === true ? "disabled" : input.disabled === false && server.status === "disabled" ? "draft" : undefined;

    await repository.updateServer(
      ctx.workspaceId,
      serverId,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.endpointUrl !== undefined ? { endpointUrl: input.endpointUrl } : {}),
        ...(input.authKind !== undefined ? { authKind: input.authKind } : {}),
        ...(status ? { status } : {}),
      },
      client,
    );

    // Switching to `none` removes the stored envelope: leaving a credential
    // behind that nothing sends is a secret kept for no reason.
    if (input.authKind === "none") {
      await repository.clearServerSecret(ctx.workspaceId, serverId, client);
    } else if (input.credential) {
      const header = input.credentialHeader ?? server.credentialHeader ?? MCP_DEFAULT_CREDENTIAL_HEADER;
      await repository.upsertServerSecret(
        ctx.workspaceId,
        serverId,
        sealSecret(input.credential, secretContext(ctx.workspaceId, serverId)),
        header,
        client,
      );
    } else if (input.credentialHeader && server.hasCredential) {
      // Renaming the header alone means re-sealing the same value, which needs
      // the plaintext. Refused rather than half-applied.
      throw ApiError.badRequest("Re-enter the credential to change which header it is sent in.");
    }

    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "mcp_server",
        entityId: serverId,
        action: "updated",
        summary: `Updated MCP server “${input.name ?? server.name}”`,
      },
      client,
    );
  });

  return getMcpServer(ctx, serverId);
}

export async function deleteMcpServer(ctx: McpContext, serverId: string): Promise<void> {
  const server = await repository.findServerById(ctx.workspaceId, serverId);
  if (!server) throw ApiError.notFound("MCP server not found");

  await withWorkspace(ctx.workspaceId, async (client) => {
    await repository.deleteServer(ctx.workspaceId, serverId, client);
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "mcp_server",
        entityId: serverId,
        action: "deleted",
        summary: `Disconnected MCP server “${server.name}”`,
      },
      client,
    );
  });
}

export interface McpProbeOutcome {
  ok: boolean;
  status: McpServerStatus;
  message: string;
  toolCount: number;
}

/**
 * Probes a server and records the result.
 *
 * There is no separate "connect": the protocol has no sessions, so a probe is
 * a real `tools/list`. Testing anything less would test something the product
 * never does.
 */
export async function probeMcpServer(ctx: McpContext, serverId: string): Promise<McpProbeOutcome> {
  const server = await repository.findServerById(ctx.workspaceId, serverId);
  if (!server) throw ApiError.notFound("MCP server not found");

  const config = await connectionFor(ctx.workspaceId, serverId, server.endpointUrl, server.authKind);
  const result = await probeServer(config);
  const checkedAt = new Date();

  const outcome: McpProbeOutcome = result.ok
    ? { ok: true, status: "active", message: result.message, toolCount: result.toolCount }
    : { ok: false, status: statusFor(result.failure), message: result.failure.message, toolCount: server.toolCount };

  await repository.recordProbe(ctx.workspaceId, serverId, { ...outcome, checkedAt });
  return outcome;
}

export interface McpDiscoveryOutcome {
  ok: boolean;
  message: string;
  tools: McpToolView[];
  /** Tools the server offered that we refused to store, with the reason. */
  rejected: Array<{ name: string; reason: string }>;
  truncated: boolean;
}

/**
 * Re-reads the tool list and stores the snapshot.
 *
 * Grants are untouched. A tool whose definition changed keeps its grant row,
 * and `toToolViews` marks it stale from the live hash comparison — which is
 * the whole point of pinning. Re-discovery must never be able to re-approve
 * anything.
 */
export async function discoverMcpTools(ctx: McpContext, serverId: string): Promise<McpDiscoveryOutcome> {
  const server = await repository.findServerById(ctx.workspaceId, serverId);
  if (!server) throw ApiError.notFound("MCP server not found");

  const config = await connectionFor(ctx.workspaceId, serverId, server.endpointUrl, server.authKind);
  const result = await discoverTools(config);
  const checkedAt = new Date();

  if (!result.ok) {
    await repository.recordProbe(ctx.workspaceId, serverId, {
      ok: false,
      status: statusFor(result.failure),
      message: result.failure.message,
      toolCount: server.toolCount,
      checkedAt,
    });
    return { ok: false, message: result.failure.message, tools: [], rejected: [], truncated: false };
  }

  const { tools, rejected, truncated } = result.discovered;

  await withWorkspace(ctx.workspaceId, async (client) => {
    await repository.replaceServerTools(ctx.workspaceId, serverId, tools, client);
    await repository.recordProbe(
      ctx.workspaceId,
      serverId,
      { ok: true, status: "active", message: `${tools.length} tools discovered`, toolCount: tools.length, checkedAt },
      client,
    );
  });

  const grants = await repository.listGrants(ctx.workspaceId, serverId);
  const views = toToolViews(tools, grants);
  const stale = views.filter((view) => view.stale).length;

  const parts = [`${tools.length} tool${tools.length === 1 ? "" : "s"} available`];
  if (stale > 0) parts.push(`${stale} approval${stale === 1 ? "" : "s"} need reviewing again`);
  if (rejected.length > 0) parts.push(`${rejected.length} skipped`);

  return { ok: true, message: parts.join(", "), tools: views, rejected, truncated };
}

/** Tools and their grants, for the approval screen. */
export async function listMcpTools(ctx: McpContext, serverId: string): Promise<McpToolView[]> {
  const server = await repository.findServerById(ctx.workspaceId, serverId);
  if (!server) throw ApiError.notFound("MCP server not found");

  const [tools, grants] = await Promise.all([
    repository.listServerTools(ctx.workspaceId, serverId),
    repository.listGrants(ctx.workspaceId, serverId),
  ]);
  return toToolViews(tools, grants);
}

/**
 * Records which tools a person has approved.
 *
 * Two things happen here that cannot be moved to the client. The approved hash
 * is read from the **stored tool**, never from the request, so a caller cannot
 * pin an approval to a definition of their own invention. And approval is
 * forced on for any destructive grant, so a crafted request cannot disable it.
 */
export async function setMcpGrants(ctx: McpContext, serverId: string, input: SetMcpGrantsInput): Promise<McpToolView[]> {
  const server = await repository.findServerById(ctx.workspaceId, serverId);
  if (!server) throw ApiError.notFound("MCP server not found");

  const tools = await repository.listServerTools(ctx.workspaceId, serverId);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const unknown = input.grants.filter((grant) => !byName.has(grant.toolName)).map((grant) => grant.toolName);
  if (unknown.length > 0) {
    throw ApiError.badRequest(`That server does not offer: ${unknown.slice(0, 5).join(", ")}. Refresh the tool list and try again.`);
  }

  const grants = input.grants.map((grant) => ({
    toolName: grant.toolName,
    approvedHash: byName.get(grant.toolName)!.contentHash,
    riskClass: grant.riskClass,
    requiresApproval: approvalIsMandatory(grant.riskClass) ? true : grant.requiresApproval,
  }));

  await withWorkspace(ctx.workspaceId, async (client) => {
    await repository.replaceGrants(ctx.workspaceId, serverId, grants, ctx.userId, client);
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "mcp_server",
        entityId: serverId,
        action: "tools_approved",
        summary: `Approved ${grants.length} MCP tool${grants.length === 1 ? "" : "s"} on “${server.name}”`,
        metadata: { destructive: grants.filter((grant) => grant.riskClass === "destructive").length },
      },
      client,
    );
  });

  return toToolViews(tools, await repository.listGrants(ctx.workspaceId, serverId));
}
