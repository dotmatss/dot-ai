import { AppBadge } from "@/components/ui/app-badge";
import { COLLECTION_STATUS_META, KNOWLEDGE_SOURCE_STATUS_META } from "@/features/knowledge/constants";
import { isSourceInFlight, type CollectionStatus, type KnowledgeSourceStatus } from "@/features/knowledge/types";

export function CollectionStatusBadge({ status, size }: { status: CollectionStatus; size?: "sm" | "md" }) {
  const meta = COLLECTION_STATUS_META[status];
  return (
    <AppBadge tone={meta.tone} dot size={size} title={meta.description}>
      {meta.label}
    </AppBadge>
  );
}

/**
 * Covers the whole source lifecycle. Only a stage that is still moving becomes
 * a live region, so a screen reader hears the pipeline advance without every
 * settled row in the table announcing itself.
 */
export function KnowledgeSourceStatusBadge({ status, size }: { status: KnowledgeSourceStatus; size?: "sm" | "md" }) {
  const meta = KNOWLEDGE_SOURCE_STATUS_META[status];
  const inFlight = isSourceInFlight(status);
  return (
    <AppBadge
      tone={meta.tone}
      dot
      size={size}
      title={meta.description}
      {...(inFlight ? { role: "status" as const, "aria-live": "polite" as const } : {})}
      className={inFlight ? "animate-pulse" : undefined}
    >
      {meta.label}
    </AppBadge>
  );
}
