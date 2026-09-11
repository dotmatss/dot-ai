import "server-only";

import { query, type Queryable } from "@/server/db/client";

export type UsageKind = "message" | "tokens_in" | "tokens_out" | "workflow_run" | "embedding" | "retrieval";

export async function recordUsage(
  input: { workspaceId: string; kind: UsageKind; quantity?: number; refType?: string; refId?: string | null },
  client?: Queryable,
): Promise<void> {
  await query(
    `INSERT INTO usage_events (workspace_id, kind, quantity, ref_type, ref_id) VALUES ($1, $2, $3, $4, $5)`,
    [input.workspaceId, input.kind, input.quantity ?? 1, input.refType ?? null, input.refId ?? null],
    client,
  );
}

export async function recordUsageBatch(
  workspaceId: string,
  events: Array<{ kind: UsageKind; quantity: number; refType?: string; refId?: string | null }>,
  client?: Queryable,
): Promise<void> {
  if (events.length === 0) return;
  const values: unknown[] = [];
  const rows = events.map((event, index) => {
    const base = index * 5;
    values.push(workspaceId, event.kind, event.quantity, event.refType ?? null, event.refId ?? null);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });
  await query(`INSERT INTO usage_events (workspace_id, kind, quantity, ref_type, ref_id) VALUES ${rows.join(", ")}`, values, client);
}
