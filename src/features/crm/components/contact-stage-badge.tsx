import { AppBadge } from "@/components/ui/app-badge";
import { CONTACT_STAGE_META } from "@/features/crm/constants";
import type { ContactStage } from "@/features/crm/types";

/** Stage is always shown with its label, so the tone is reinforcement, not the signal. */
export function ContactStageBadge({ stage, size = "md" }: { stage: ContactStage; size?: "sm" | "md" }) {
  const meta = CONTACT_STAGE_META[stage];
  return (
    <AppBadge tone={meta.tone} size={size} dot>
      {meta.label}
    </AppBadge>
  );
}
