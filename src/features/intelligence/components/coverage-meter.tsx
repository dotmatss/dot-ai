import { AppProgressBar } from "@/components/ui/app-progress";
import { KNOWLEDGE_GAP_COVERAGE_THRESHOLD } from "@/features/intelligence/constants";
import { formatRate } from "@/features/intelligence/metrics";

/**
 * Knowledge coverage for one topic.
 *
 * The tone is tied to the same threshold the gap filter uses, so a bar that
 * reads as bad and a topic that appears under "Knowledge gaps" are never in
 * disagreement - both come from `KNOWLEDGE_GAP_COVERAGE_THRESHOLD`.
 */
export function CoverageMeter({ value, size = "sm" }: { value: number; size?: "sm" | "md" }) {
  const tone = value <= KNOWLEDGE_GAP_COVERAGE_THRESHOLD ? "danger" : value < 0.8 ? "warning" : "success";
  return (
    <AppProgressBar
      value={Math.round(value * 100)}
      label={`Answered from knowledge: ${formatRate(value)}`}
      tone={tone}
      size={size}
      showValue
    />
  );
}
