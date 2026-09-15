import "server-only";

import type { PoolClient } from "pg";

import { withDb } from "@/server/db/client";
import { activityLog } from "@/server/db/schema";

export interface ActivityInput {
  workspaceId: string;
  actorId: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

/** Append-only audit trail powering "recent activity" and future compliance needs. */
export async function recordActivity(input: ActivityInput, client?: PoolClient): Promise<void> {
  await withDb(
    (db) =>
      db.insert(activityLog).values({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        summary: input.summary,
        metadata: input.metadata ?? {},
      }),
    client,
  );
}
