import { Check, X } from "lucide-react";

import { AI_CAPABILITY_LABELS } from "@/features/platform/ai-constants";
import { AI_CAPABILITIES, type AiCapability } from "@/features/platform/ai-types";
import { cn } from "@/lib/cn";

/**
 * The capability matrix for one model.
 *
 * Shows three states, not two, because the difference is the whole point of
 * having two columns in the database:
 *
 *   ✓ offered      the model supports it AND the platform offers it
 *   ◦ supported    the model supports it, the platform does not offer it
 *   ✗ unsupported  the model cannot do it, so it can never be offered
 *
 * Collapsing the middle state into "off" would make an operator unable to tell
 * "we chose not to" from "it cannot", which are the two questions this screen
 * exists to answer.
 */
export function ModelCapabilityGrid({
  capabilities,
  availableFor,
  className,
}: {
  capabilities: AiCapability[];
  availableFor: AiCapability[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1", className)}>
      {AI_CAPABILITIES.map((capability) => {
        const supported = capabilities.includes(capability);
        const offered = availableFor.includes(capability);
        const label = AI_CAPABILITY_LABELS[capability];

        return (
          <li
            key={capability}
            className={cn(
              "flex items-center gap-1.5 text-sm",
              offered ? "text-foreground" : supported ? "text-foreground-muted" : "text-foreground-muted/60",
            )}
          >
            {offered ? (
              <Check aria-hidden className="size-3.5 text-success" />
            ) : supported ? (
              <span aria-hidden className="inline-block size-3.5 text-center leading-none">
                ◦
              </span>
            ) : (
              <X aria-hidden className="size-3.5" />
            )}
            <span className={cn(!supported && "line-through")}>{label}</span>
            {/* The visual states above are reinforced in text, so the meaning
                does not depend on colour or on an icon alone. */}
            <span className="sr-only">
              {offered ? " — offered" : supported ? " — supported but not offered" : " — not supported"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
