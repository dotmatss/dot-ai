import type { BadgeTone } from "@/components/ui/app-badge";
import type { HealthStatus, OrganizationStatus } from "@/features/platform/types";

export const ORGANIZATION_STATUS_META: Record<OrganizationStatus, { label: string; tone: BadgeTone; description: string }> = {
  active: { label: "Active", tone: "success", description: "Members can sign in and use every workspace." },
  suspended: {
    label: "Suspended",
    tone: "warning",
    description: "Members cannot open the organization's workspaces. Reversible, and no data is deleted.",
  },
  disabled: {
    label: "Disabled",
    tone: "danger",
    description: "Access is closed pending removal. Reversible until the organization is deleted; no data is deleted by this state.",
  },
};

export const HEALTH_META: Record<HealthStatus, { label: string; tone: BadgeTone }> = {
  healthy: { label: "Healthy", tone: "success" },
  degraded: { label: "Degraded", tone: "warning" },
  unavailable: { label: "Unavailable", tone: "danger" },
  /** Not instrumented. Deliberately not drawn as healthy. */
  unknown: { label: "Not monitored", tone: "neutral" },
};

export const AUDIT_RESULT_META: Record<"success" | "denied" | "error", { label: string; tone: BadgeTone }> = {
  success: { label: "Success", tone: "success" },
  denied: { label: "Denied", tone: "danger" },
  error: { label: "Error", tone: "warning" },
};

/**
 * Actions written by this feature's services.
 *
 * Named as constants so the audit filter can offer real choices and a typo in a
 * service cannot silently create a parallel action name. `platform.access.denied`
 * is written by `platformRoute` rather than by a service.
 */
export const PLATFORM_AUDIT_ACTIONS = [
  "platform.access.denied",
  "platform.admin.granted",
  "platform.admin.revoked",
  "organization.status.changed",
  "user.disabled",
  "user.enabled",
  "ai.provider.created",
  "ai.provider.updated",
  "ai.provider.deleted",
  "ai.model.created",
  "ai.model.updated",
  "ai.model.deleted",
  "ai.embedding_model.created",
  "ai.embedding_model.updated",
  "ai.embedding_model.deleted",
] as const;

export const MAX_STATUS_REASON_LENGTH = 500;
