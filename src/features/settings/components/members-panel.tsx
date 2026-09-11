"use client";

import { UserMinus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppAlert } from "@/components/ui/app-alert";
import { AppAvatar } from "@/components/ui/app-avatar";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSelect } from "@/components/ui/app-select";
import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableMessageRow,
  AppTableRow,
} from "@/components/ui/app-table";
import { AppText } from "@/components/ui/app-typography";
import { MEMBER_INVITES_UNAVAILABLE_NOTE, MEMBER_ROLE_BADGE } from "@/features/settings/constants";
import {
  assignableRoles,
  canAdministerMember,
  canChangeMemberRole,
  canRemoveMember,
  type MemberActor,
} from "@/features/settings/member-rules";
import { useRemoveMemberMutation, useUpdateMemberRoleMutation } from "@/features/settings/mutations";
import { useMembersQuery } from "@/features/settings/queries";
import type { MembersOverview, OrganizationMember } from "@/features/settings/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage, MEMBER_ROLE_LABELS, type MemberRole } from "@/features/workspaces/roles";

const COLUMNS = 4;

function RoleBadge({ role }: { role: MemberRole }) {
  const badge = MEMBER_ROLE_BADGE[role];
  return (
    <AppBadge tone={badge.tone} variant={badge.variant}>
      {MEMBER_ROLE_LABELS[role]}
    </AppBadge>
  );
}

interface MemberRowProps {
  member: OrganizationMember;
  actor: MemberActor;
  ownerCount: number;
  busy: boolean;
  onChangeRole: (member: OrganizationMember, role: MemberRole) => void;
  onRemove: (member: OrganizationMember) => void;
}

function MemberRow({ member, actor, ownerCount, busy, onChangeRole, onRemove }: MemberRowProps) {
  const subject = { userId: member.userId, role: member.role };
  // The same predicates the route handler runs. Disabling a control the server
  // would refuse is the point: the decision is not made here, only mirrored.
  const administer = canAdministerMember({ actor, subject });
  const removal = canRemoveMember({ actor, subject, ownerCount });

  const roleOptions = assignableRoles(actor.role).map((role) => ({
    value: role,
    label: MEMBER_ROLE_LABELS[role],
    disabled: !canChangeMemberRole({ actor, subject, nextRole: role, ownerCount }).allowed,
  }));

  return (
    <AppTableRow>
      <AppTableCell>
        <span className="flex items-center gap-3">
          <AppAvatar name={member.name} src={member.avatarUrl} size="sm" />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium text-foreground">{member.name}</span>
              {member.isCurrentUser ? (
                <AppBadge size="sm" tone="neutral" variant="outline">
                  You
                </AppBadge>
              ) : null}
            </span>
            <span className="block truncate text-xs text-foreground-muted">{member.email}</span>
          </span>
        </span>
      </AppTableCell>
      <AppTableCell className="w-56">
        {administer.allowed ? (
          <AppSelect
            size="sm"
            aria-label={`Role for ${member.name}`}
            value={member.role}
            disabled={busy}
            options={roleOptions}
            onChange={(event) => onChangeRole(member, event.target.value as MemberRole)}
          />
        ) : (
          <span className="flex flex-col gap-1">
            <RoleBadge role={member.role} />
            {/* Someone who cannot manage anyone is told once, above the table. */}
            {canManage(actor.role) ? (
              <AppText size="sm" tone="muted">
                {administer.reason}
              </AppText>
            ) : null}
          </span>
        )}
      </AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        <AppRelativeTime value={member.joinedAt} />
      </AppTableCell>
      <AppTableCell className="w-32 text-right align-top">
        {removal.allowed ? (
          <AppButton variant="ghost" size="sm" onClick={() => onRemove(member)} disabled={busy} leadingIcon={<UserMinus aria-hidden />}>
            Remove
            <span className="sr-only"> {member.name}</span>
          </AppButton>
        ) : administer.allowed ? (
          <AppText size="sm" tone="muted" className="text-right">
            {removal.reason}
          </AppText>
        ) : null}
      </AppTableCell>
    </AppTableRow>
  );
}

function MembersTable({ overview }: { overview: MembersOverview }) {
  const { membership, user } = useWorkspace();
  const router = useRouter();
  const [pendingRemoval, setPendingRemoval] = useState<OrganizationMember | null>(null);
  const updateRole = useUpdateMemberRoleMutation();
  const removeMember = useRemoveMemberMutation();

  const actor: MemberActor = { userId: user.id, role: membership.role };
  const busy = updateRole.isPending || removeMember.isPending;

  function handleChangeRole(member: OrganizationMember, role: MemberRole) {
    if (role === member.role) return;
    updateRole.mutate(
      { userId: member.userId, role, name: member.name },
      {
        // Changing your own role changes what the whole shell may render, and
        // that shell came from the server.
        onSuccess: () => {
          if (member.isCurrentUser) router.refresh();
        },
      },
    );
  }

  function handleRemove(member: OrganizationMember) {
    removeMember.mutate(
      { userId: member.userId, name: member.name },
      {
        onSuccess: () => {
          setPendingRemoval(null);
          // Removing yourself ends your access to this workspace; staying on
          // the page would only render a 404 on the next request.
          if (member.isCurrentUser) router.replace("/");
          else router.refresh();
        },
        onError: () => setPendingRemoval(null),
      },
    );
  }

  return (
    <>
      {!canManage(membership.role) ? (
        <AppText size="sm" tone="muted">
          Only admins and owners can change roles or remove people.
        </AppText>
      ) : null}
      <AppTableContainer aria-busy={busy || undefined}>
        <AppTable>
          <AppTableHeader>
            <AppTableRow>
              <AppTableHead>Member</AppTableHead>
              <AppTableHead>Role</AppTableHead>
              <AppTableHead>Joined</AppTableHead>
              <AppTableHead>
                <span className="sr-only">Actions</span>
              </AppTableHead>
            </AppTableRow>
          </AppTableHeader>
          <AppTableBody>
            {overview.members.length === 0 ? (
              <AppTableMessageRow colSpan={COLUMNS}>
                <AppEmptyState
                  size="sm"
                  icon={<Users aria-hidden />}
                  title="No members"
                  description="This organization has no members to show."
                />
              </AppTableMessageRow>
            ) : (
              overview.members.map((member) => (
                <MemberRow
                  key={member.userId}
                  member={member}
                  actor={actor}
                  ownerCount={overview.ownerCount}
                  busy={busy}
                  onChangeRole={handleChangeRole}
                  onRemove={setPendingRemoval}
                />
              ))
            )}
          </AppTableBody>
        </AppTable>
      </AppTableContainer>

      <AppConfirmDialog
        open={Boolean(pendingRemoval)}
        onClose={() => setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval) handleRemove(pendingRemoval);
        }}
        title={`Remove ${pendingRemoval?.name ?? ""}?`}
        description={
          pendingRemoval?.isCurrentUser
            ? "You will lose access to this organization and every workspace in it. Another admin has to add you back."
            : "They lose access to every workspace in this organization immediately. The records they created stay."
        }
        confirmLabel="Remove member"
        destructive
        loading={removeMember.isPending}
      />
    </>
  );
}

export function MembersPanel() {
  const query = useMembersQuery();

  return (
    <div className="flex flex-col gap-4">
      {/* There is no invitations table, so there is nowhere to store a pending
          invite. Saying so beats a button that cannot work. */}
      <AppAlert tone="neutral" title="Adding members">
        {MEMBER_INVITES_UNAVAILABLE_NOTE}
      </AppAlert>
      {query.isPending ? (
        <AppListSkeleton rows={4} />
      ) : query.isError ? (
        <AppTableContainer>
          <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />
        </AppTableContainer>
      ) : (
        <MembersTable overview={query.data} />
      )}
    </div>
  );
}
