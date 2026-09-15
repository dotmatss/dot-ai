/**
 * Client-safe audit contracts. Timestamps are ISO strings; nothing here carries
 * a database cursor, a metadata blob or an actor's email.
 *
 * `entityType` and `action` are free text in `activity_log` - a dozen services
 * write them and no enum constrains them - so every consumer must render an
 * unknown value rather than dropping the row. A log that silently hides what it
 * does not recognise is worse than one that shows a raw string.
 */

export interface AuditEntry {
  id: string;
  /** Null once the actor's account is deleted: `actor_id` is ON DELETE SET NULL. */
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  summary: string;
  createdAt: string;
}

export interface AuditListFilters {
  q?: string;
  actorId?: string;
  entityType?: string;
  action?: string;
  /** Inclusive date bounds as YYYY-MM-DD, interpreted in the server's timezone. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/**
 * The values actually present in this workspace's log, so the filter controls
 * only offer choices that can return a row.
 */
export interface AuditFacets {
  entityTypes: string[];
  actions: string[];
  actors: Array<{ id: string; name: string }>;
}
