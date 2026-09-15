"use client";

import { LogOut, ExternalLink } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { AppDropdownMenu, AppDropdownMenuItem, AppDropdownMenuSeparator } from "@/components/ui/app-dropdown-menu";
import { signOutAction } from "@/features/auth/actions";

/**
 * Account menu for the platform plane.
 *
 * A separate component from `UserMenu` rather than a reuse, because that one
 * reads `useWorkspace()` - the workspace, its slug and the caller's membership -
 * and the platform plane deliberately has no `WorkspaceProvider`. Reusing it
 * would have meant teaching the customer menu to render without a tenant, which
 * is how a control plane ends up one bug away from linking an operator into
 * somebody's workspace settings.
 *
 * So it takes the email as a prop and offers only what exists here: leaving the
 * plane, and signing out. Both actions are the same underlying ones the
 * customer shell uses - `signOutAction` destroys the session row and clears the
 * cookie - so an operator's sign-out is not a second, weaker implementation.
 */
export function OperatorMenu({ email }: { email: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <AppDropdownMenu
      label="Operator account"
      className="min-w-56"
      trigger={
        <button
          type="button"
          className="flex max-w-56 items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-ring"
          aria-label={`Operator account menu for ${email}`}
          disabled={pending}
        >
          <span className="truncate">{email}</span>
        </button>
      }
    >
      <div className="px-2.5 py-2">
        <p className="truncate text-sm font-medium">Platform operator</p>
        <p className="truncate text-xs text-foreground-muted">{email}</p>
      </div>
      <AppDropdownMenuSeparator />
      {/*
        Leaving the plane is not signing out: an operator who also holds a
        customer account should be able to step out to the product without
        ending the session, and one who does not will simply land on the
        marketing page. Keeping the two separate is why both are listed.
      */}
      <AppDropdownMenuItem icon={<ExternalLink aria-hidden />} onSelect={() => router.push("/" as Route)}>
        Leave admin
      </AppDropdownMenuItem>
      <AppDropdownMenuSeparator />
      <AppDropdownMenuItem icon={<LogOut aria-hidden />} onSelect={() => startTransition(() => signOutAction())}>
        Sign out
      </AppDropdownMenuItem>
    </AppDropdownMenu>
  );
}
