"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailPlus, UserMinus, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppFormActions, AppFormField, AppFormSection } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppAvatar } from "@/components/ui/app-avatar";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppCodeBlock } from "@/components/ui/app-code-block";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppInput } from "@/components/ui/app-input";
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
import { INVITATION_STATUS_META, INVITE_DELIVERY_NOTE, MEMBER_ROLE_BADGE } from "@/features/settings/constants";
import {
  assignableRoles,
  canAdministerMember,
  canChangeMemberRole,
  canRemoveMember,
  type MemberActor,
} from "@/features/settings/member-rules";
import {
  useInviteMemberMutation,
  useRemoveMemberMutation,
  useRevokeInvitationMutation,
  useUpdateMemberRoleMutation,
} from "@/features/settings/mutations";
import { useMembersQuery } from "@/features/settings/queries";
import { inviteMemberFormSchema, type InviteMemberFormValues } from "@/features/settings/schemas";
import type { MembersOverview, OrganizationInvitation, OrganizationMember } from "@/features/settings/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage, MEMBER_ROLE_LABELS, type MemberRole } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";

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

/**
 * Creating an invitation.
 *
 * The link renders from `invite.data`, which lives only as long as this
 * component: the server keeps a hash of the token, so once this unmounts the
 * URL cannot be recovered and a new invitation has to be created. Saying that
 * beside the link is the difference between someone copying it now and coming
 * back for it tomorrow.
 */
function InviteForm({ actor }: { actor: MemberActor }) {
  const invite = useInviteMemberMutation();
  const roleOptions = assignableRoles(actor.role).map((role) => ({ value: role, label: MEMBER_ROLE_LABELS[role] }));

  const form = useForm<InviteMemberFormValues>({
    resolver: zodResolver(inviteMemberFormSchema),
    defaultValues: { email: "", role: "member" },
  });

  const onSubmit = form.handleSubmit((values) => {
    invite.mutate(values, {
      onSuccess: () => form.reset({ email: "", role: values.role }),
      onError: (error) => {
        // "Already a member" and "already invited" are both about the address,
        // so they belong on the field and not only in a toast.
        if (isApiError(error) && error.status === 409) form.setError("email", { message: error.message });
      },
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <AppFormSection
        title="Invite someone"
        description="They join this organization and every workspace in it, with the role you pick."
      >
        <AppAlert tone="neutral" title="Invitations are shared by link">
          {INVITE_DELIVERY_NOTE}
        </AppAlert>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <AppFormField label="Email address" required error={form.formState.errors.email?.message}>
            {(field) => (
              <AppInput
                {...field}
                {...form.register("email")}
                type="email"
                autoComplete="off"
                placeholder="teammate@example.com"
              />
            )}
          </AppFormField>
          <AppFormField label="Role" error={form.formState.errors.role?.message}>
            {(field) => <AppSelect {...field} {...form.register("role")} options={roleOptions} />}
          </AppFormField>
        </div>
        <AppFormActions>
          <AppButton type="submit" loading={invite.isPending} leadingIcon={<MailPlus aria-hidden />}>
            Create invitation
          </AppButton>
        </AppFormActions>
        {invite.data ? (
          <div className="flex flex-col gap-2">
            <AppCodeBlock label={`Invitation link for ${invite.data.invitation.email}`} code={invite.data.inviteUrl} />
            <AppText size="sm" tone="muted">
              This link is shown once. If you lose it, revoke the invitation and create a new one.
            </AppText>
          </div>
        ) : null}
      </AppFormSection>
    </form>
  );
}

function InvitationsTable({ invitations, canRevoke }: { invitations: OrganizationInvitation[]; canRevoke: boolean }) {
  const revoke = useRevokeInvitationMutation();

  return (
    <AppFormSection title="Pending invitations" description="Links that have been created but not accepted yet.">
      {invitations.length === 0 ? (
        <AppText size="sm" tone="muted">
          No pending invitations.
        </AppText>
      ) : (
        <AppTableContainer aria-busy={revoke.isPending || undefined}>
          <AppTable>
            <AppTableHeader>
              <AppTableRow>
                <AppTableHead>Email</AppTableHead>
                <AppTableHead>Role</AppTableHead>
                <AppTableHead>Status</AppTableHead>
                <AppTableHead>Expires</AppTableHead>
                <AppTableHead>
                  <span className="sr-only">Actions</span>
                </AppTableHead>
              </AppTableRow>
            </AppTableHeader>
            <AppTableBody>
              {invitations.map((invitation) => {
                const status = INVITATION_STATUS_META[invitation.status];
                return (
                  <AppTableRow key={invitation.id}>
                    <AppTableCell className="truncate font-medium text-foreground">{invitation.email}</AppTableCell>
                    <AppTableCell>
                      <RoleBadge role={invitation.role} />
                    </AppTableCell>
                    <AppTableCell>
                      <AppBadge tone={status.tone} variant="soft">
                        {status.label}
                      </AppBadge>
                    </AppTableCell>
                    <AppTableCell className="whitespace-nowrap text-foreground-muted">
                      <AppRelativeTime value={invitation.expiresAt} />
                    </AppTableCell>
                    <AppTableCell className="w-32 text-right">
                      {canRevoke ? (
                        <AppButton
                          variant="ghost"
                          size="sm"
                          disabled={revoke.isPending}
                          leadingIcon={<X aria-hidden />}
                          onClick={() => revoke.mutate({ invitationId: invitation.id, email: invitation.email })}
                        >
                          Revoke
                          <span className="sr-only"> the invitation for {invitation.email}</span>
                        </AppButton>
                      ) : null}
                    </AppTableCell>
                  </AppTableRow>
                );
              })}
            </AppTableBody>
          </AppTable>
        </AppTableContainer>
      )}
    </AppFormSection>
  );
}

export function MembersPanel() {
  const query = useMembersQuery();
  const { membership, user } = useWorkspace();
  const actor: MemberActor = { userId: user.id, role: membership.role };
  const manages = canManage(membership.role);

  return (
    <div className="flex flex-col gap-6">
      {manages ? <InviteForm actor={actor} /> : null}
      {query.isPending ? (
        <AppListSkeleton rows={4} />
      ) : query.isError ? (
        <AppTableContainer>
          <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />
        </AppTableContainer>
      ) : (
        <>
          <MembersTable overview={query.data} />
          {/* The server sends no invitations to anyone who cannot manage them,
              so rendering the section would only ever say "none" - which reads
              as a fact about the organization rather than about the reader. */}
          {manages ? <InvitationsTable invitations={query.data.invitations} canRevoke /> : null}
        </>
      )}
    </div>
  );
}
