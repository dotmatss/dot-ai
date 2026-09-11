import { FileText, Link2, Type, type LucideIcon } from "lucide-react";

import { KNOWLEDGE_SOURCE_TYPE_META } from "@/features/knowledge/constants";
import type { KnowledgeSourceType } from "@/features/knowledge/types";
import { cn } from "@/lib/cn";

const ICON: Record<KnowledgeSourceType, LucideIcon> = {
  text: Type,
  url: Link2,
  file: FileText,
};

/** Icon plus a visually hidden type name, so the glyph is never the only cue. */
export function SourceTypeIcon({ type, className }: { type: KnowledgeSourceType; className?: string }) {
  const Icon = ICON[type];
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary",
        className,
      )}
    >
      <Icon aria-hidden className="size-4" />
      <span className="sr-only">{KNOWLEDGE_SOURCE_TYPE_META[type].label} source</span>
    </span>
  );
}
