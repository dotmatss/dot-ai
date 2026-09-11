"use client";

import { Check, ChevronDown } from "lucide-react";

import { AppDropdownMenu, AppDropdownMenuItem } from "@/components/ui/app-dropdown-menu";
import { ContactStageBadge } from "@/features/crm/components/contact-stage-badge";
import { CONTACT_STAGE_META, CONTACT_STAGE_ORDER } from "@/features/crm/constants";
import { useUpdateContactMutation } from "@/features/crm/mutations";
import type { Contact } from "@/features/crm/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

/**
 * Stage picker attached to the badge in the header. Stage is the field that
 * changes most often, and each change is written to the contact's history, so
 * it gets a one-click control instead of living only inside the edit dialog.
 */
export function ContactStageControl({ contact }: { contact: Contact }) {
  const { membership } = useWorkspace();
  const update = useUpdateContactMutation(contact.id, { silent: true });
  const current = CONTACT_STAGE_META[contact.stage];

  if (!canEdit(membership.role)) return <ContactStageBadge stage={contact.stage} />;

  return (
    <AppDropdownMenu
      label="Change stage"
      align="start"
      trigger={
        <button
          type="button"
          aria-label={`Stage: ${current.label}. Change stage`}
          className="inline-flex items-center gap-1 rounded-full focus-ring"
        >
          <ContactStageBadge stage={contact.stage} />
          <ChevronDown aria-hidden className="size-3.5 text-foreground-muted" />
        </button>
      }
    >
      {CONTACT_STAGE_ORDER.map((stage) => {
        const isCurrent = stage === contact.stage;
        return (
          <AppDropdownMenuItem
            key={stage}
            icon={isCurrent ? <Check aria-hidden /> : <span aria-hidden className="size-4" />}
            aria-label={isCurrent ? `${CONTACT_STAGE_META[stage].label} (current stage)` : `Set stage to ${CONTACT_STAGE_META[stage].label}`}
            disabled={update.isPending || isCurrent}
            onSelect={() => update.mutate({ stage })}
          >
            {CONTACT_STAGE_META[stage].label}
          </AppDropdownMenuItem>
        );
      })}
    </AppDropdownMenu>
  );
}
