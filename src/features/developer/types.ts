/**
 * The developer surface: how a customer's own systems reach this workspace.
 *
 * Deliberately separate from `src/features/integrations/`, which is the other
 * direction — what this workspace reaches out to. The two used to share a
 * feature module and a tab bar, and the result was a page where "API keys" and
 * "Credentials" sat side by side meaning opposite things.
 *
 *   developer     INBOUND  — API keys, embeds. Someone calls us.
 *   integrations  OUTBOUND — catalogue, credentials, MCP. We call someone.
 *
 * See ADR 0006 for why outbound credentials are stored the way they are, and
 * `docs/feature-conventions.md` for the boundary rule this split follows.
 */

export interface ApiKey {
  id: string;
  name: string;
  /** Display-safe leading characters of the key; the rest is only ever hashed. */
  keyPrefix: string;
  createdAt: string;
  createdByName: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Returned exactly once, by the create endpoint. The plaintext is never stored. */
export interface CreatedApiKey {
  apiKey: ApiKey;
  secret: string;
}

export type ApiKeyStatusFilter = "active" | "revoked";

export interface ApiKeyListFilters {
  status?: ApiKeyStatusFilter;
  page?: number;
  pageSize?: number;
}
