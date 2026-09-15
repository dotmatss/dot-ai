import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppCard } from "@/components/ui/app-card";
import { AppHeading } from "@/components/ui/app-typography";
import { InvitedSignUpForm } from "@/features/auth/components/invited-sign-up-form";
import { SignUpForm } from "@/features/auth/components/sign-up-form";
import { invitationTokenSchema } from "@/features/auth/schemas";
import { redirectIfSignedIn } from "@/features/auth/server/redirect-if-signed-in";
import { previewInvitation } from "@/features/settings/server/invitation-service";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  await redirectIfSignedIn();

  const params = await searchParams;
  const token = typeof params.invite === "string" ? invitationTokenSchema.safeParse(params.invite) : null;
  const invitation = token?.success ? await previewInvitation(token.data) : null;

  // A link that no longer resolves is not this page's story to tell: /invite
  // owns every "expired / withdrawn / not valid" message, so send it there
  // rather than silently offering to create a brand new organization instead.
  if (token?.success && !invitation) redirect(`/invite/${token.data}`);

  if (invitation && token?.success) {
    return (
      <AppCard padding="lg" className="shadow-md">
        <div className="mb-6">
          <AppHeading level={2}>Join {invitation.organizationName}</AppHeading>
          <p className="mt-1 text-sm text-foreground-muted">
            Create your account to accept the invitation. No new organization is created.
          </p>
        </div>
        <InvitedSignUpForm token={token.data} email={invitation.email} />
      </AppCard>
    );
  }

  return (
    <AppCard padding="lg" className="shadow-md">
      <div className="mb-6">
        <AppHeading level={2}>Create your account</AppHeading>
        <p className="mt-1 text-sm text-foreground-muted">Set up your organization and first workspace in one step.</p>
      </div>
      <SignUpForm />
    </AppCard>
  );
}
