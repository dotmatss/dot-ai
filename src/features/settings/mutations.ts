import { useMutation, useQueryClient } from "@tanstack/react-query";

import { settingsApi, type SessionRevocationScope } from "@/features/settings/api";
import { settingsKeys } from "@/features/settings/queries";
import type { InviteMemberInput, UpdateProfileInput, UpdateWorkspaceNameInput } from "@/features/settings/schemas";
import type { InvitationCreated, MembersOverview, UserProfile } from "@/features/settings/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { MEMBER_ROLE_LABELS, type MemberRole } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { toast } from "@/stores/toast-store";

function errorMessage(error: unknown, fallback: string): string {
  // Member rules refuse with an explanation ("must keep at least one owner");
  // showing it is the whole point of returning it as the 403 message.
  return isApiError(error) ? error.message : fallback;
}

export function useRenameWorkspaceMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: UpdateWorkspaceNameInput) => settingsApi.renameWorkspace(slug, input),
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsKeys.general(slug), settings);
      toast.success({ title: "Workspace renamed", description: `This workspace is now “${settings.name}”.` });
    },
    onError: (error) =>
      toast.error({ title: "Could not rename the workspace", description: errorMessage(error, "Please try again.") }),
  });
}

/** Both member writes return the whole overview, so the cache is replaced, not patched. */
export function useUpdateMemberRoleMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: MemberRole; name: string }) =>
      settingsApi.updateMemberRole(slug, userId, { role }),
    onSuccess: (overview: MembersOverview, variables) => {
      queryClient.setQueryData(settingsKeys.members(slug), overview);
      toast.success({
        title: "Role updated",
        description: `${variables.name} is now ${MEMBER_ROLE_LABELS[variables.role].toLowerCase()}.`,
      });
    },
    onError: (error) =>
      toast.error({ title: "Could not change the role", description: errorMessage(error, "Please try again.") }),
  });
}

export function useRemoveMemberMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: ({ userId }: { userId: string; name: string }) => settingsApi.removeMember(slug, userId),
    onSuccess: (overview: MembersOverview, variables) => {
      queryClient.setQueryData(settingsKeys.members(slug), overview);
      toast.success({ title: "Member removed", description: `${variables.name} no longer has access.` });
    },
    onError: (error) =>
      toast.error({ title: "Could not remove the member", description: errorMessage(error, "Please try again.") }),
  });
}

/**
 * Inviting returns the whole overview *and* the one-time link. The cache takes
 * the overview; the link stays in `mutation.data` for the panel to show, and is
 * gone as soon as that component unmounts - which is the truth about it.
 */
export function useInviteMemberMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: InviteMemberInput) => settingsApi.inviteMember(slug, input),
    onSuccess: (result: InvitationCreated) => {
      queryClient.setQueryData(settingsKeys.members(slug), result.overview);
      toast.success({
        title: "Invitation created",
        description: `Copy the link and send it to ${result.invitation.email}.`,
      });
    },
    onError: (error) =>
      toast.error({ title: "Could not create the invitation", description: errorMessage(error, "Please try again.") }),
  });
}

export function useRevokeInvitationMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: ({ invitationId }: { invitationId: string; email: string }) =>
      settingsApi.revokeInvitation(slug, invitationId),
    onSuccess: (overview: MembersOverview, variables) => {
      queryClient.setQueryData(settingsKeys.members(slug), overview);
      toast.success({ title: "Invitation revoked", description: `The link sent to ${variables.email} no longer works.` });
    },
    onError: (error) =>
      toast.error({ title: "Could not revoke the invitation", description: errorMessage(error, "Please try again.") }),
  });
}

export function useRevokeSessionMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (sessionId: string) => settingsApi.revokeSession(slug, sessionId),
    onSuccess: (result) => {
      queryClient.setQueryData(settingsKeys.sessions(slug), result.sessions);
      // When the caller ended their own session the page is already signed out;
      // a success toast would be replaced by the redirect before it is read.
      if (!result.currentSessionRevoked) toast.success({ title: "Signed out", description: "That device was signed out." });
    },
    onError: (error) =>
      toast.error({ title: "Could not sign out that device", description: errorMessage(error, "Please try again.") }),
  });
}

export function useRevokeSessionsMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (scope: SessionRevocationScope) => settingsApi.revokeSessions(slug, scope),
    onSuccess: (result) => {
      queryClient.setQueryData(settingsKeys.sessions(slug), result.sessions);
      if (!result.currentSessionRevoked) {
        toast.success({ title: "Signed out", description: "Every other device was signed out." });
      }
    },
    onError: (error) =>
      toast.error({ title: "Could not sign out those devices", description: errorMessage(error, "Please try again.") }),
  });
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => settingsApi.updateProfile(slug, input),
    onSuccess: (profile: UserProfile) => {
      queryClient.setQueryData(settingsKeys.profile(slug), profile);
      toast.success({ title: "Profile saved", description: "Your details were updated." });
    },
    onError: (error) =>
      toast.error({ title: "Could not save your profile", description: errorMessage(error, "Please try again.") }),
  });
}
