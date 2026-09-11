import type { Metadata } from "next";

import { AppCard } from "@/components/ui/app-card";
import { AppHeading } from "@/components/ui/app-typography";
import { SignUpForm } from "@/features/auth/components/sign-up-form";
import { redirectIfSignedIn } from "@/features/auth/server/redirect-if-signed-in";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  await redirectIfSignedIn();
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
