import "server-only";

import type { PoolClient } from "pg";

import { withDb } from "@/server/db/client";
import { usageEvents } from "@/server/db/schema";

export type UsageKind = "message" | "tokens_in" | "tokens_out" | "workflow_run" | "embedding" | "retrieval";

export async function recordUsage(
  input: { workspaceId: string; kind: UsageKind; quantity?: number; refType?: string; refId?: string | null },
  client?: PoolClient,
): Promise<void> {
  await withDb(
    (db) =>
      db.insert(usageEvents).values({
        workspaceId: input.workspaceId,
        kind: input.kind,
        quantity: BigInt(input.quantity ?? 1),
        refType: input.refType ?? null,
        refId: input.refId ?? null,
      }),
    client,
  );
}

export async function recordUsageBatch(
  workspaceId: string,
  events: Array<{ kind: UsageKind; quantity: number; refType?: string; refId?: string | null }>,
  client?: PoolClient,
): Promise<void> {
  if (events.length === 0) return;
  await withDb(
    (db) =>
      db.insert(usageEvents).values(
        events.map((event) => ({
          workspaceId,
          kind: event.kind,
          quantity: BigInt(event.quantity),
          refType: event.refType ?? null,
          refId: event.refId ?? null,
        })),
      ),
    client,
  );
}
