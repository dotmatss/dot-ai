import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { AppBadge } from "@/components/ui/app-badge";
import { OperatorMenu } from "@/features/platform/components/operator-menu";
import { PlatformNav } from "@/features/platform/components/platform-nav";
import { requirePlatformAccess } from "@/server/auth/platform-dal";

/**
 * The platform plane's shell.
 *
 * `requirePlatformAccess()` here is a convenience for rendering, NOT the
 * control. A layout does not re-run for every navigation and cannot protect the
 * JSON API at all, so each page underneath calls it again and every
 * /api/admin route goes through `platformRoute`. This call is what stops an
 * unauthorized visitor seeing the chrome; the ones underneath are what stop
 * them seeing data.
 *
 * Deliberately NOT wrapped in `AppShell`: the customer shell carries a
 * workspace switcher, workspace navigation and a `WorkspaceProvider`, none of
 * which exist in a plane that has no workspace. Reusing it would have meant
 * teaching it to render without a tenant - which is how a control plane ends up
 * one bug away from leaking one tenant's context into another's screen.
 *
 * It is visibly a different environment (full-width, its own header, an
 * explicit badge) while using the same tokens, primitives and spacing, so an
 * operator can never mistake which plane they are acting in.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user } = await requirePlatformAccess();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface">
        <PageContainer width="wide" className="gap-4 py-4 lg:py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link href={"/admin" as Route} className="text-sm font-semibold">
                Platform control plane
              </Link>
              <AppBadge tone="warning" variant="outline" size="sm">
                Operator
              </AppBadge>
            </div>
            {/*
              Sign-out lives here because the platform plane does not render
              `AppShell`, and `AppShell` is where the customer `UserMenu` (and
              therefore the only sign-out control) normally sits. Without this
              an operator could reach /admin and then have no way out of the
              session short of clearing a cookie.
            */}
            <OperatorMenu email={user.email} />
          </div>
          <PlatformNav />
        </PageContainer>
      </header>

      <PageContainer width="wide">{children}</PageContainer>
    </div>
  );
}
