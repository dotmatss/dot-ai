import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/layout/brand-logo";
import { AppCard } from "@/components/ui/app-card";
import { AppHeading } from "@/components/ui/app-typography";
import { CreateWorkspaceForm } from "@/features/workspaces/components/create-workspace-form";
import { listUserOrganizations } from "@/features/workspaces/server/workspace-repository";
import { requireAuthOrRedirect } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Create workspace" };

export default async function OnboardingPage() {
  const auth = await requireAuthOrRedirect("/onboarding");
  const organizations = (await listUserOrganizations(auth.user.id)).filter((org) => org.role === "owner" || org.role === "admin");

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-topbar items-center px-6">
        <Link href="/" className="inline-flex items-center gap-2.5 rounded-md focus-ring">
          <BrandMark />
          <span className="text-sm font-semibold tracking-tight">Dot</span>
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <AppCard padding="lg" className="w-full max-w-md shadow-md">
          <div className="mb-6">
            <AppHeading level={2}>Create a workspace</AppHeading>
            <p className="mt-1 text-sm text-foreground-muted">
              {organizations.length > 0
                ? "Add another workspace to one of your organizations."
                : "You are not an admin of any organization. Ask an owner to invite you or create a workspace for you."}
            </p>
          </div>
          {organizations.length > 0 ? <CreateWorkspaceForm organizations={organizations} /> : null}
        </AppCard>
      </main>
    </div>
  );
}
