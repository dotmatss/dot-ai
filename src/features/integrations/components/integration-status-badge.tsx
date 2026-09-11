import { AppBadge } from "@/components/ui/app-badge";
import { INTEGRATION_STATUS_META } from "@/features/integrations/constants";
import type { IntegrationStatus } from "@/features/integrations/types";

/** Status is always spelled out; the tone is reinforcement, never the only signal. */
export function IntegrationStatusBadge({ status, size }: { status: IntegrationStatus; size?: "sm" | "md" }) {
  const meta = INTEGRATION_STATUS_META[status];
  return (
    <AppBadge tone={meta.tone} size={size} dot>
      {meta.label}
    </AppBadge>
  );
}
