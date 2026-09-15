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

/**
 * Outbound credentials.
 *
 * The mirror image of `ApiKey` in `src/features/developer/types.ts`. The two
 * live in different features precisely because they were easy to confuse while
 * they sat in one:
 *
 *   ApiKey     - INBOUND. Authenticates somebody calling our public API as this
 *                workspace. Stored as a hash; the plaintext is unrecoverable.
 *   Credential - OUTBOUND. Authenticates us when a workflow calls somebody
 *                else's API on this workspace's behalf. Encrypted, because it
 *                has to be sent.
 */
export const CREDENTIAL_TYPES = ["bearer", "header", "basic"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

/**
 * A stored credential as every client sees it.
 *
 * There is no field here for the secret, and that is the type doing its job:
 * nothing that decrypts is reachable from a route that returns this shape.
 * `headerPreview` is the header NAME the credential will set, which is
 * configuration rather than secret material - it is what lets the builder show
 * "sets Authorization" without the value.
 */
export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  /** Header this credential sets on a request, e.g. "Authorization". */
  headerPreview: string;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  lastUsedAt: string | null;
}

export interface CredentialListFilters {
  type?: CredentialType;
  search?: string;
  page?: number;
  pageSize?: number;
}
