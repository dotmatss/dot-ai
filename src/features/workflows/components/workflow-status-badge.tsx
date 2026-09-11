import { AppBadge } from "@/components/ui/app-badge";
import { RUN_STATUS_META, STEP_STATUS_META, WORKFLOW_STATUS_META } from "@/features/workflows/constants";
import type { WorkflowRunStatus, WorkflowStatus, WorkflowStepStatus } from "@/features/workflows/types";

export function WorkflowStatusBadge({ status, size }: { status: WorkflowStatus; size?: "sm" | "md" }) {
  const meta = WORKFLOW_STATUS_META[status];
  return (
    <AppBadge tone={meta.tone} dot size={size}>
      {meta.label}
    </AppBadge>
  );
}

export function RunStatusBadge({ status, size }: { status: WorkflowRunStatus; size?: "sm" | "md" }) {
  const meta = RUN_STATUS_META[status];
  return (
    <AppBadge tone={meta.tone} dot size={size}>
      {meta.label}
    </AppBadge>
  );
}

export function StepStatusBadge({ status, size }: { status: WorkflowStepStatus; size?: "sm" | "md" }) {
  const meta = STEP_STATUS_META[status];
  return (
    <AppBadge tone={meta.tone} dot size={size}>
      {meta.label}
    </AppBadge>
  );
}
