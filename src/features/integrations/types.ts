export const INTEGRATION_PROVIDERS = ["webhook", "slack", "zapier", "email_smtp", "google_sheets", "hubspot"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

/** Connection state of one workspace's integration row (matches the `integration_status` enum). */
export const INTEGRATION_STATUSES = ["connected", "disconnected", "error"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/** Catalog availability, independent of any workspace. */
export type IntegrationAvailability = "available" | "coming_soon";

export const INTEGRATION_CATEGORIES = ["automation", "messaging", "email", "data"] as const;
export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export interface IntegrationTestOutcome {
  ok: boolean;
  /** Operator-facing summary. Never contains secret material or response bodies. */
  message: string;
  checkedAt: string;
}

/**
 * A workspace's connection to a provider.
 *
 * `config` carries non-secret values only. Secret material is never part of
 * this type: `configuredSecretFields` names which secrets are set so the UI can
 * show a "configured" indicator and a Replace action.
 */
export interface Integration {
  id: string;
  provider: IntegrationProvider;
  name: string;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  configuredSecretFields: string[];
  lastTest: IntegrationTestOutcome | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationTestResult extends IntegrationTestOutcome {
  integration: Integration;
}

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
