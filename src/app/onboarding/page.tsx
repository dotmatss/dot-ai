import type { Metadata, Route } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/layout/brand-logo";
import { AppCard } from "@/components/ui/app-card";
import { AppHeading } from "@/components/ui/app-typography";
import { CreateWorkspaceForm } from "@/features/workspaces/components/create-workspace-form";
import { listUserOrganizations } from "@/features/workspaces/server/workspace-repository";
import { requireVerifiedAuthOrRedirect } from "@/server/auth/dal";
import { getPlatformGrant } from "@/server/auth/platform-dal";

export const metadata: Metadata = { title: "Create workspace" };

export default async function OnboardingPage() {
  // Verified, not merely signed in: this page CREATES workspaces, and it is
  // reached by exactly the accounts that have none - so the workspace guard
  // that carries the gate everywhere else never runs here.
  const auth = await requireVerifiedAuthOrRedirect("/onboarding");
  const [organizations, platformGrant] = await Promise.all([
    listUserOrganizations(auth.user.id).then((orgs) => orgs.filter((org) => org.role === "owner" || org.role === "admin")),
    getPlatformGrant(auth.user.id),
  ]);

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
          {/*
            A dedicated platform operator belongs to no organization, so this
            page is otherwise a dead end for them: no form, and a message about
            not being an admin anywhere. The link is rendered only for an
            account that already holds the grant, so it discloses nothing to
            anyone else - and it is a link, not an authorization.
          */}
          {platformGrant ? (
            <p className={organizations.length > 0 ? "mt-6 border-t border-border pt-4 text-sm" : "text-sm"}>
              This account operates the platform.{" "}
              <Link href={"/admin" as Route} className="underline underline-offset-4">
                Go to the control plane
              </Link>
              .
            </p>
          ) : null}
        </AppCard>
      </main>
    </div>
  );
}
