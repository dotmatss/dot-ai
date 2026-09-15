import type { ReactNode } from "react";

import { BentoCard } from "@/features/marketing/components/bento-card";
import { ChatPreview, ToolPreview, WorkflowPreview } from "@/features/marketing/components/bento-visuals";
import { CAPABILITIES } from "@/features/marketing/content";
import { cn } from "@/lib/cn";

/** Illustration for a tile, where one earns its place. */
const VISUALS: Record<string, ReactNode> = {
  chatbots: <ChatPreview />,
  agents: <ToolPreview />,
  workflows: <WorkflowPreview />,
};

/**
 * The capability grid: one tall tile beside a stacked pair.
 *
 * The rows are only declared from `md` up, so the single-column phone layout
 * keeps every tile at its natural height instead of forcing three cards into
 * two equal rows.
 *
 * A plain grid container rather than a list: every tile is an article or a
 * link, which already carries its own semantics, and wrapping them in list
 * items would need `display: contents` to keep the spans working — a known way
 * to drop elements out of the accessibility tree.
 */
export function BentoGrid({ className }: { className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2 md:grid-rows-2", className)}>
      {CAPABILITIES.map((capability) => (
        <BentoCard
          key={capability.key}
          eyebrow={capability.eyebrow}
          title={capability.title}
          description={capability.description}
          icon={capability.icon}
          tall={capability.tall}
          href={capability.docsHref}
        >
          {VISUALS[capability.key]}
        </BentoCard>
      ))}
    </div>
  );
}
