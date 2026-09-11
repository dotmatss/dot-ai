import "server-only";

import { query, type Queryable } from "@/server/db/client";

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
export async function recordActivity(input: ActivityInput, client?: Queryable): Promise<void> {
  await query(
    `INSERT INTO activity_log (workspace_id, actor_id, entity_type, entity_id, action, summary, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.workspaceId, input.actorId, input.entityType, input.entityId, input.action, input.summary, input.metadata ?? {}],
    client,
  );
}
