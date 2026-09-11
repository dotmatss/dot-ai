"use client";

import { AppDialog } from "@/components/ui/app-dialog";
import { AppList, AppListItem } from "@/components/ui/app-list-item";
import { AppOverline } from "@/components/ui/app-typography";
import { NODE_CATEGORY_META, nodeTypesByCategory, type WorkflowNodeType } from "@/features/workflows/domain/node-types";

/**
 * Step picker grouped by category. Triggers are hidden once the workflow has
 * one, because a definition may only ever have a single trigger.
 */
export function AddStepDialog({
  open,
  onClose,
  onPick,
  allowTriggers,
  anchorLabel,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (type: WorkflowNodeType) => void;
  allowTriggers: boolean;
  anchorLabel: string | null;
}) {
  const groups = nodeTypesByCategory().filter((group) => allowTriggers || group.category !== "trigger");

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Add a step"
      description={anchorLabel ? `Inserted after “${anchorLabel}”.` : "Added to the workflow."}
    >
      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <section key={group.category} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <AppOverline>{NODE_CATEGORY_META[group.category].label}</AppOverline>
              <span className="text-xs text-foreground-muted">{NODE_CATEGORY_META[group.category].description}</span>
            </div>
            <AppList>
              {group.types.map((nodeType) => {
                const Icon = nodeType.icon;
                return (
                  <AppListItem
                    key={nodeType.id}
                    icon={<Icon aria-hidden />}
                    title={nodeType.label}
                    description={nodeType.description}
                    onClick={() => {
                      onPick(nodeType.id);
                      onClose();
                    }}
                  />
                );
              })}
            </AppList>
          </section>
        ))}
      </div>
    </AppDialog>
  );
}
