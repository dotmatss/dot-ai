import type { Metadata } from "next";

import { AppCard } from "@/components/ui/app-card";
import { AppHeading } from "@/components/ui/app-typography";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { redirectIfSignedIn } from "@/features/auth/server/redirect-if-signed-in";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  await redirectIfSignedIn();
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  return (
    <AppCard padding="lg" className="shadow-md">
      <div className="mb-6">
        <AppHeading level={2}>Welcome back</AppHeading>
        <p className="mt-1 text-sm text-foreground-muted">Sign in to your workspace.</p>
      </div>
      <SignInForm next={next} />
    </AppCard>
  );
}
