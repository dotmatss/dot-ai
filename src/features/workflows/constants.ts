import type { BadgeTone } from "@/components/ui/app-badge";
import type { WorkflowRunStatus, WorkflowStatus, WorkflowStepStatus, WorkflowTriggerKind } from "@/features/workflows/types";

export const WORKFLOW_STATUS_META: Record<WorkflowStatus, { label: string; tone: BadgeTone; description: string }> = {
  draft: { label: "Draft", tone: "neutral", description: "Being built; only manual test runs are possible." },
  active: { label: "Active", tone: "success", description: "Triggers are live and runs start automatically." },
  paused: { label: "Paused", tone: "warning", description: "Triggers are ignored until you activate it again." },
  archived: { label: "Archived", tone: "neutral", description: "Hidden from lists and never runs." },
};

export const RUN_STATUS_META: Record<WorkflowRunStatus, { label: string; tone: BadgeTone; description: string }> = {
  queued: { label: "Queued", tone: "neutral", description: "Waiting to start." },
  running: { label: "Running", tone: "info", description: "Steps are being executed." },
  succeeded: { label: "Succeeded", tone: "success", description: "Every step finished without an error." },
  failed: { label: "Failed", tone: "danger", description: "A step failed and the run stopped." },
  cancelled: { label: "Cancelled", tone: "neutral", description: "Stopped before it finished." },
  waiting_approval: { label: "Waiting", tone: "warning", description: "Paused until someone approves the next step." },
};

export const STEP_STATUS_META: Record<WorkflowStepStatus, { label: string; tone: BadgeTone }> = {
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  skipped: { label: "Skipped", tone: "neutral" },
};

export const TRIGGER_KIND_LABELS: Record<WorkflowTriggerKind, string> = {
  manual: "Manual",
  webhook: "Webhook",
  conversation: "Conversation",
  api: "API",
  schedule: "Schedule",
};

/** Guard against oversized jsonb payloads on the run endpoint. */
export const RUN_INPUT_MAX_CHARS = 20_000;

export const WORKFLOW_NAME_MAX = 80;
export const WORKFLOW_DESCRIPTION_MAX = 280;
