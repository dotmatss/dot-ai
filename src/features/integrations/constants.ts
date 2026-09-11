import type { BadgeTone } from "@/components/ui/app-badge";
import type { IntegrationCategory, IntegrationStatus } from "@/features/integrations/types";

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

export const API_KEY_PREFIX = "dot_live_";

/** Characters of randomness after the prefix. 24 random bytes encode to exactly 32 base64url characters. */
export const API_KEY_RANDOM_BYTES = 24;
export const API_KEY_RANDOM_LENGTH = 32;

/** How much of the key is stored in clear for display: the prefix plus a short discriminator. */
export const API_KEY_DISPLAY_CHARS = 6;

export const INTEGRATION_TEST_TIMEOUT_MS = 5_000;
