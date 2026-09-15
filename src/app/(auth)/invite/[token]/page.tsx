import type { Metadata } from "next";
import type { Route } from "next";

import { AppAlert } from "@/components/ui/app-alert";
import { AppButtonLink } from "@/components/ui/app-button";
import { AppCard } from "@/components/ui/app-card";
import { AppHeading, AppText } from "@/components/ui/app-typography";
import { AcceptInvitationButton } from "@/features/auth/components/accept-invitation-button";
import { invitationTokenSchema } from "@/features/auth/schemas";
import { previewInvitation } from "@/features/settings/server/invitation-service";
import { MEMBER_ROLE_DESCRIPTIONS, MEMBER_ROLE_LABELS } from "@/features/workspaces/roles";
import { getAuthContext } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Invitation" };

/**
 * The invitee's landing page.
 *
 * Deliberately tenant-less: the only thing it knows is what the token resolves
 * to, and the only thing it shows is the organization's name and the role being
 * offered. It never lists members, never names a workspace, and renders the
 * same "not valid" card for a revoked, accepted, expired-and-deleted, mistyped
 * or forged token, so the page cannot be used to probe which links exist.
 *
 * It is not wrapped in `redirectIfSignedIn` like the other pages in this group:
 * being signed in is the *normal* way to accept.
 */
function NotValidCard({ title, description }: { title: string; description: string }) {
  return (
    <AppCard padding="lg" className="shadow-md">
      <AppHeading level={2}>{title}</AppHeading>
      <AppText className="mt-2" tone="muted">
        {description}
      </AppText>
      <div className="mt-6">
        <AppButtonLink href="/sign-in" variant="secondary" fullWidth>
          Go to sign in
        </AppButtonLink>
      </div>
    </AppCard>
  );
}

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;

  const parsed = invitationTokenSchema.safeParse(token);
  const invitation = parsed.success ? await previewInvitation(parsed.data) : null;

  if (!invitation) {
    return (
      <NotValidCard
        title="This invitation is not valid"
        description="The link may have been used already, withdrawn, or mistyped. Ask whoever invited you for a new one."
      />
    );
  }

  // `status` is resolved on the server: comparing dates here would be an impure
  // call during render, and the two sides could disagree by a request's length.
  if (invitation.status === "expired") {
    return (
      <NotValidCard
        title="This invitation has expired"
        description={`Invitations to ${invitation.organizationName} are only valid for a few days. Ask for a new link.`}
      />
    );
  }

  const ctx = await getAuthContext();
  const signedInAs = ctx?.user.email.toLowerCase();
  const invitedEmail = invitation.email.toLowerCase();

  return (
    <AppCard padding="lg" className="shadow-md">
      <AppHeading level={2}>Join {invitation.organizationName}</AppHeading>
      <AppText className="mt-2" tone="muted">
        {invitation.invitedByName
          ? `${invitation.invitedByName} invited ${invitation.email} to join as ${MEMBER_ROLE_LABELS[invitation.role].toLowerCase()}.`
          : `${invitation.email} was invited to join as ${MEMBER_ROLE_LABELS[invitation.role].toLowerCase()}.`}
      </AppText>
      <AppText className="mt-1" size="sm" tone="muted">
        {MEMBER_ROLE_DESCRIPTIONS[invitation.role]}
      </AppText>

      <div className="mt-6">
        {!ctx ? (
          <div className="flex flex-col gap-3">
            <AppButtonLink href={`/sign-up?invite=${encodeURIComponent(token)}` as Route} size="lg" fullWidth>
              Create your account
            </AppButtonLink>
            <AppButtonLink
              href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}` as Route}
              variant="secondary"
              fullWidth
            >
              I already have an account
            </AppButtonLink>
          </div>
        ) : signedInAs === invitedEmail ? (
          <AcceptInvitationButton token={token} organizationName={invitation.organizationName} />
        ) : (
          // An invitation is issued to an address, not to whoever holds the
          // link. Saying which address avoids the dead end of an accept button
          // that would always refuse.
          <AppAlert tone="warning" title="This invitation is for a different account">
            {`It was sent to ${invitation.email}, and you are signed in as ${ctx.user.email}. Sign out and sign back in as ${invitation.email} to accept it.`}
          </AppAlert>
        )}
      </div>
    </AppCard>
  );
}
