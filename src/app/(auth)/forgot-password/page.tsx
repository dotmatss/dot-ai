import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppCard } from "@/components/ui/app-card";
import { AppHeading } from "@/components/ui/app-typography";
import { isFirebaseAuthEnabled } from "@/config/firebase";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";
import { redirectIfSignedIn } from "@/features/auth/server/redirect-if-signed-in";

export const metadata: Metadata = { title: "Reset your password" };

/**
 * Password reset exists only where Firebase does.
 *
 * The built-in scrypt credentials have no reset flow and are not getting one -
 * they exist so the application runs without a Firebase project, not as a
 * product. A 404 rather than an explanation: in a deployment without Firebase
 * this page genuinely does not exist, and `SignInForm` does not link to it.
 */
export default async function ForgotPasswordPage() {
  if (!isFirebaseAuthEnabled()) notFound();
  await redirectIfSignedIn();

  return (
    <AppCard padding="lg" className="shadow-md">
      <div className="mb-6">
        <AppHeading level={2}>Reset your password</AppHeading>
        <p className="mt-1 text-sm text-foreground-muted">
          Enter your email address and we&rsquo;ll send you a link to choose a new password.
        </p>
      </div>
      <ForgotPasswordForm />
    </AppCard>
  );
}
