import "server-only";

import { ApiError } from "@/lib/api/api-error";

/**
 * Shape-checks a server id from a URL path before it reaches PostgreSQL.
 *
 * A malformed uuid would otherwise surface as a driver-level cast failure and
 * a 500. It answers 404, the same as a well-formed id belonging to another
 * workspace, so a caller learns nothing from the difference.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertMcpServerId(value: string): string {
  if (!UUID_PATTERN.test(value)) throw ApiError.notFound("MCP server not found");
  return value;
}

export function assertMcpCallId(value: string): string {
  if (!UUID_PATTERN.test(value)) throw ApiError.notFound("That tool call was not found");
  return value;
}
