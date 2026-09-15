import type { BadgeTone } from "@/components/ui/app-badge";
import type { CredentialType, IntegrationCategory, IntegrationStatus } from "@/features/integrations/types";

export const INTEGRATION_STATUS_META: Record<IntegrationStatus, { label: string; tone: BadgeTone; description: string }> = {
  connected: { label: "Connected", tone: "success", description: "Configured and reachable." },
  disconnected: { label: "Not connected", tone: "neutral", description: "Not configured for this workspace yet." },
  error: { label: "Needs attention", tone: "danger", description: "The last connection test failed." },
};

export const INTEGRATION_CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  automation: "Automation",
  messaging: "Messaging",
  email: "Email",
  data: "Data",
};

/** Shown instead of a secret value once one is stored. */
export const SECRET_PLACEHOLDER = "Configured";

export const INTEGRATION_TEST_TIMEOUT_MS = 5_000;

/**
 * Credential kinds, as data.
 *
 * `secretFields` is the contract between the form, the request schema and the
 * sealed envelope: all three iterate this list rather than restating the field
 * names, so adding a kind cannot leave one of them behind.
 */
export const CREDENTIAL_TYPE_META: Record<
  CredentialType,
  {
    label: string;
    description: string;
    /** Header this kind sets. `null` means the operator chooses it. */
    header: string | null;
    secretFields: ReadonlyArray<{ key: string; label: string; placeholder?: string }>;
  }
> = {
  bearer: {
    label: "Bearer token",
    description: "Sends Authorization: Bearer <token>. The common choice for modern REST APIs.",
    header: "Authorization",
    secretFields: [{ key: "token", label: "Token", placeholder: "sk_live_…" }],
  },
  header: {
    label: "Custom header",
    description: "Sends the value in a header you name, for APIs that do not use Authorization.",
    header: null,
    secretFields: [{ key: "value", label: "Value", placeholder: "The value to send" }],
  },
  basic: {
    label: "Basic auth",
    description: "Sends Authorization: Basic, encoding the username and password for you.",
    header: "Authorization",
    secretFields: [
      { key: "username", label: "Username" },
      { key: "password", label: "Password" },
    ],
  },
};

/**
 * The header a credential will set, resolved for display and for the request.
 *
 * Pure and shared on purpose: the builder labels a step with it, and the
 * executor sets it. Deriving it in two places is how the two drift.
 */
export function credentialHeaderName(type: CredentialType, headerName: string | null): string {
  return CREDENTIAL_TYPE_META[type].header ?? (headerName ?? "").trim();
}

/**
 * Headers a credential may not set.
 *
 * `Host` and the `Content-*` family belong to the request the step builds, and
 * letting a stored credential overwrite them turns a credential into a way to
 * rewrite the request itself. The `Authorization` case is handled by the type,
 * not by this list.
 */
export const CREDENTIAL_RESERVED_HEADERS: readonly string[] = [
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "upgrade",
  "te",
  "trailer",
  "expect",
];
