import { Check, Minus } from "lucide-react";

import { AppBadge } from "@/components/ui/app-badge";
import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableRow,
} from "@/components/ui/app-table";
import { AppHeading, AppText } from "@/components/ui/app-typography";
import { MEMBER_RULE_MESSAGES } from "@/features/settings/member-rules";
import { capabilitiesByArea, CAPABILITY_ROLE_ORDER } from "@/features/settings/permissions";
import { hasMinimumRole, MEMBER_ROLE_DESCRIPTIONS, MEMBER_ROLE_LABELS, type MemberRole } from "@/features/workspaces/roles";

/**
 * What each role can do, rendered from the same table the drift test checks
 * against the route handlers. Nothing here is hand-written prose about
 * permissions: if a floor moves and this page is not updated, the page is not
 * what breaks - the test is.
 *
 * A Server Component: it reads no data and has no interaction, so it ships no
 * JavaScript.
 */
function Allowed({ allowed, role, capability }: { allowed: boolean; role: MemberRole; capability: string }) {
  // A glyph alone is invisible to a screen reader, and "check" in a grid of
  // checks says nothing about which cell it is in.
  const label = `${MEMBER_ROLE_LABELS[role]}: ${allowed ? "can" : "cannot"} ${capability.toLowerCase()}`;
  return (
    <span className="flex justify-center">
      {allowed ? (
        <Check aria-hidden className="size-4 text-foreground" />
      ) : (
        <Minus aria-hidden className="size-4 text-foreground-subtle" />
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function RolesMatrix({ currentRole }: { currentRole: MemberRole }) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <AppHeading level={3}>Roles</AppHeading>
        <dl className="grid gap-3 sm:grid-cols-2">
          {CAPABILITY_ROLE_ORDER.map((role) => (
            <div key={role} className="rounded-lg border border-border bg-surface p-4">
              <dt className="flex items-center gap-2">
                <span className="font-medium text-foreground">{MEMBER_ROLE_LABELS[role]}</span>
                {role === currentRole ? (
                  <AppBadge size="sm" tone="neutral" variant="outline">
                    Your role
                  </AppBadge>
                ) : null}
              </dt>
              <dd className="mt-1 text-sm text-foreground-muted">{MEMBER_ROLE_DESCRIPTIONS[role]}</dd>
            </div>
          ))}
        </dl>
      </section>

      {capabilitiesByArea().map((group) => (
        <section key={group.area} className="flex flex-col gap-2">
          <AppHeading level={3}>{group.label}</AppHeading>
          <AppTableContainer>
            <AppTable>
              <AppTableHeader>
                <AppTableRow>
                  <AppTableHead>Capability</AppTableHead>
                  {CAPABILITY_ROLE_ORDER.map((role) => (
                    <AppTableHead key={role} className="w-24 text-center">
                      {MEMBER_ROLE_LABELS[role]}
                    </AppTableHead>
                  ))}
                </AppTableRow>
              </AppTableHeader>
              <AppTableBody>
                {group.capabilities.map((capability) => (
                  <AppTableRow key={capability.key}>
                    <AppTableCell className="text-foreground">{capability.label}</AppTableCell>
                    {CAPABILITY_ROLE_ORDER.map((role) => (
                      <AppTableCell key={role} className="text-center">
                        <Allowed
                          allowed={hasMinimumRole(role, capability.minimumRole)}
                          role={role}
                          capability={capability.label}
                        />
                      </AppTableCell>
                    ))}
                  </AppTableRow>
                ))}
              </AppTableBody>
            </AppTable>
          </AppTableContainer>
        </section>
      ))}

      <section className="flex flex-col gap-2">
        <AppHeading level={3}>Rules that apply on top of the table</AppHeading>
        {/* Sourced from the strings the server returns when it refuses, so the
            explanation here and the error there cannot drift apart. */}
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground-muted">
          <li>{MEMBER_RULE_MESSAGES.ownerRequiredToModifyOwner}</li>
          <li>{MEMBER_RULE_MESSAGES.ownerRequiredToPromote}</li>
          <li>{MEMBER_RULE_MESSAGES.inviteOwnerRequired}</li>
          <li>{MEMBER_RULE_MESSAGES.lastOwnerRole}</li>
        </ul>
        <AppText size="sm" tone="muted">
          Roles are held on the organization, so a role applies in every workspace it owns.
        </AppText>
      </section>
    </div>
  );
}
