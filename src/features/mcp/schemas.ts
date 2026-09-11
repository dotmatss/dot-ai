import { z } from "zod";

import { isPublicHttpUrl } from "@/features/integrations/url-safety";
import { MCP_AUTH_KINDS, MCP_RISK_CLASSES } from "@/features/mcp/types";
import { MCP_TOOL_NAME_PATTERN } from "@/features/mcp/constants";

/**
 * Request validation for the MCP feature.
 *
 * The endpoint rule is the one worth reading. It reuses the existing
 * destination policy (`isPublicHttpUrl`, which rejects embedded credentials,
 * unusual ports and non-routable literals) and then narrows it to https,
 * because the MCP specification's authorization flow assumes TLS and a
 * credential sent over plain http is a credential given away.
 *
 * These are input checks, not the security boundary. They stop obvious
 * mistakes early and produce a decent message; the guarded fetch re-checks
 * everything at request time, including after DNS resolution and on every
 * redirect, because a URL that was safe when it was saved may not be when it
 * is used.
 */

const httpsEndpoint = z
  .string()
  .trim()
  .min(1, { error: "Enter the server's MCP endpoint." })
  .max(2_048, { error: "That URL is too long." })
  .refine((value) => value.toLowerCase().startsWith("https://"), {
    error: "MCP endpoints must use https://.",
  })
  .refine(isPublicHttpUrl, {
    error: "That host is not publicly reachable. Loopback, link-local and private addresses cannot be used.",
  });

const serverName = z
  .string()
  .trim()
  .min(2, { error: "Give the server a name of at least 2 characters." })
  .max(60, { error: "Keep the name under 60 characters." });

/**
 * Header name for a credential.
 *
 * Restricted to the HTTP token characters from RFC 9110 so a name can never
 * carry a CR or LF into a request. Header injection through a configuration
 * field is a short path to a forged request.
 */
const credentialHeader = z
  .string()
  .trim()
  .min(1, { error: "Enter the header name." })
  .max(64, { error: "Keep the header name under 64 characters." })
  .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, { error: "Use only letters, digits and the characters ! # $ % & ' * + . ^ _ ` | ~ -" });

const credential = z
  .string()
  .min(1, { error: "Enter the credential." })
  .max(4_096, { error: "That credential is too long." });

export const authKindSchema = z.enum(MCP_AUTH_KINDS);
export const riskClassSchema = z.enum(MCP_RISK_CLASSES);

/**
 * Creating a server.
 *
 * A credential is required when the auth kind is `header` and refused
 * otherwise, so a workspace cannot store a secret that nothing will ever send.
 */
export const createMcpServerSchema = z
  .object({
    name: serverName,
    endpointUrl: httpsEndpoint,
    // Required rather than defaulted: a Zod default makes the schema's input and
    // output types diverge, which React Hook Form cannot reconcile. Being
    // explicit is also better for an API caller than a silent default.
    authKind: authKindSchema,
    credentialHeader: credentialHeader.optional(),
    credential: credential.optional(),
  })
  .refine((value) => value.authKind !== "header" || Boolean(value.credential), {
    error: "A header credential needs a value.",
    path: ["credential"],
  })
  .refine((value) => value.authKind === "header" || !value.credential, {
    error: "Choose “Header credential” before entering one.",
    path: ["credential"],
  });

export type CreateMcpServerInput = z.infer<typeof createMcpServerSchema>;

/**
 * Updating a server.
 *
 * `credential` absent means "leave the stored one alone"; an empty string is
 * not accepted, because a blank field must never silently erase a working
 * credential. Removing one is done by switching `authKind` to `none`.
 */
export const updateMcpServerSchema = z.object({
  name: serverName.optional(),
  endpointUrl: httpsEndpoint.optional(),
  authKind: authKindSchema.optional(),
  credentialHeader: credentialHeader.optional(),
  credential: credential.optional(),
  disabled: z.boolean().optional(),
});

export type UpdateMcpServerInput = z.infer<typeof updateMcpServerSchema>;

/**
 * Setting the grants for a server.
 *
 * The list is the complete decision: a tool absent from it is revoked. Sending
 * a partial list would leave grants nobody can see in the UI.
 *
 * `approvedHash` is deliberately NOT accepted from the client. The pin must be
 * the hash the server actually reports, read on the server, or a caller could
 * approve a definition of their own choosing.
 */
export const setMcpGrantsSchema = z.object({
  grants: z
    .array(
      z.object({
        toolName: z.string().trim().regex(MCP_TOOL_NAME_PATTERN, { error: "That is not a valid tool name." }),
        riskClass: riskClassSchema,
        requiresApproval: z.boolean(),
      }),
    )
    .max(200, { error: "Too many tools in one request." }),
});

export type SetMcpGrantsInput = z.infer<typeof setMcpGrantsSchema>;

/**
 * Deciding a queued tool call.
 *
 * The decision is all the request carries. The tool, the server and the
 * arguments are read from the stored row, so nothing here can redirect an
 * approval at a different call or edit what would be sent.
 */
export const decideMcpToolCallSchema = z.object({
  decision: z.enum(["approve", "deny"]),
});

export type DecideMcpToolCallInput = z.output<typeof decideMcpToolCallSchema>;

export const mcpCallsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
