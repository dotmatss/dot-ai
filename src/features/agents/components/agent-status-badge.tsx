import { AppBadge } from "@/components/ui/app-badge";
import { AGENT_STATUS_META } from "@/features/agents/constants";
import type { AgentStatus } from "@/features/agents/types";

export function AgentStatusBadge({ status, size }: { status: AgentStatus; size?: "sm" | "md" }) {
  const meta = AGENT_STATUS_META[status];
  return (
    <AppBadge tone={meta.tone} dot size={size}>
      {meta.label}
    </AppBadge>
  );
}
