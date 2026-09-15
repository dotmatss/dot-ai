import type { Metadata } from "next";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { AppCard } from "@/components/ui/app-card";
import { AppHeading } from "@/components/ui/app-typography";
import { VerifyEmailPanel } from "@/features/auth/components/verify-email-panel";
import { findDefaultWorkspaceSlug } from "@/features/auth/server/auth-service";
import { requireAuthOrRedirect } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Verify your email" };

/**
 * Where `AUTHENTICATED_UNVERIFIED` waits.
 *
 * Deliberately NOT calling `redirectIfSignedIn` like its neighbours in this
 * route group: being signed in is the precondition for this page, not a reason
 * to leave it. That inversion is also what keeps the gate loop-free - the
 * workspace guard sends unverified users here, and this page is the one place
 * in the group that will not send them back.
 *
 * A verified user who arrives anyway (a bookmark, a second tab that finished
 * the flow) is forwarded on rather than shown a page about a thing they have
 * already done.
 */
export default async function VerifyEmailPage() {
  const { user } = await requireAuthOrRedirect("/verify-email");

  if (user.emailVerified) {
    const slug = await findDefaultWorkspaceSlug(user.id);
    redirect((slug ? `/w/${slug}/dashboard` : "/onboarding") as Route);
  }

  return (
    <AppCard padding="lg" className="shadow-md">
      <div className="mb-6">
        <AppHeading level={2}>Verify your email</AppHeading>
        <p className="mt-1 text-sm text-foreground-muted">
          We sent a link to <span className="font-medium text-foreground">{user.email}</span>. Open it to confirm this address,
          then come back here.
        </p>
      </div>
      <VerifyEmailPanel email={user.email} />
    </AppCard>
  );
}
