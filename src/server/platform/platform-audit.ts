import "server-only";

import type { PoolClient } from "pg";

import { withDb } from "@/server/db/client";
import { platformAuditLog } from "@/server/db/schema/control-plane";

/**
 * Append-only audit trail for the platform plane.
 *
 * Separate from `recordActivity()` because `activity_log.workspace_id` is
 * `NOT NULL ... ON DELETE CASCADE`: a platform action has no workspace to
 * attribute, and a tenant deletion would take the operator's own record of what
 * they did to that tenant with it. Outliving its subject is the property that
 * makes this table worth having.
 */

export type PlatformAuditResult = "success" | "denied" | "error";

export interface PlatformAuditInput {
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  result?: PlatformAuditResult;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Keys whose VALUES are never written, whatever they contain.
 *
 * Matching is on the key, by substring, after stripping separators and case -
 * `apiKey`, `api_key` and `API-Key` are the same key written three ways, and
 * the next spelling is unknown today. A matched value is replaced rather than
 * removed, so the log still records that something was set, which is usually
 * the fact being audited ("the key was rotated") while the key itself never is.
 */
const REDACTED_KEY_PATTERNS = [
  "secret",
  "password",
  "token",
  "apikey",
  "credential",
  "authorization",
  "cookie",
  "privatekey",
  "passphrase",
  "ciphertext",
  "signature",
  "session",
];

export const REDACTED = "[redacted]";

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return REDACTED_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/**
 * Strips credential-shaped values out of audit metadata.
 *
 * Recurses into nested objects and arrays, because a caller passing
 * `{ provider: { apiKey: "sk-..." } }` is exactly the mistake this exists for.
 * Depth is bounded so a pathological or cyclic structure cannot hang the
 * writer; anything deeper is redacted rather than trusted.
 */
export function redactMetadata(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (Array.isArray(value)) return value.map((entry) => redactMetadata(entry, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactMetadata(entry, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Records one privileged action.
 *
 * The failure behaviour depends on whether a transaction client is supplied,
 * and the split is the whole point:
 *
 * - **Inside a mutation's transaction** (`client` given) a failure PROPAGATES,
 *   which rolls the mutation back with it. The alternative - swallowing - would
 *   commit a suspension whose audit row silently did not exist, which is
 *   precisely the case the table is kept for. An action that cannot be recorded
 *   does not happen.
 * - **Outside one** (no `client`) the write is best effort. The only such
 *   caller is the denial recorder in `platformRoute`, where an audit failure
 *   must not convert a correct 404 into a 500 and hand an unauthorized caller a
 *   different response than everyone else gets.
 *
 * The best-effort log line names the action and nothing else. Database error
 * text can carry connection strings, statement fragments and column values, so
 * it is deliberately not forwarded to the console.
 */
export async function recordPlatformAudit(input: PlatformAuditInput, client?: PoolClient): Promise<void> {
  const row = {
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    targetLabel: input.targetLabel ?? null,
    result: input.result ?? "success",
    metadata: redactMetadata(input.metadata ?? {}) as Record<string, unknown>,
    ipAddress: input.ipAddress ?? null,
  };

  if (client) {
    await withDb((db) => db.insert(platformAuditLog).values(row), client);
    return;
  }

  try {
    await withDb((db) => db.insert(platformAuditLog).values(row));
  } catch {
    console.error("[platform-audit] failed to record", { action: input.action });
  }
}
