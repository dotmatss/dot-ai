"use client";

import { LogOut, Settings, UserRound } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import { AppAvatar } from "@/components/ui/app-avatar";
import { AppDropdownMenu, AppDropdownMenuItem, AppDropdownMenuSeparator } from "@/components/ui/app-dropdown-menu";
import { useSignOut } from "@/features/auth/use-sign-out";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export function UserMenu() {
  const { user, membership } = useWorkspace();
  const router = useRouter();
  const { signOut, pending } = useSignOut();

  return (
    <AppDropdownMenu
      label="Account"
      className="min-w-56"
      trigger={
        <button
          type="button"
          className="rounded-full focus-ring"
          aria-label={`Account menu for ${user.name}`}
          disabled={pending}
        >
          <AppAvatar name={user.name} src={user.avatarUrl} size="sm" />
        </button>
      }
    >
      <div className="px-2.5 py-2">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-foreground-muted">{user.email}</p>
      </div>
      <AppDropdownMenuSeparator />
      <AppDropdownMenuItem
        icon={<UserRound aria-hidden />}
        onSelect={() => router.push(`/w/${membership.workspace.slug}/settings/profile` as Route)}
      >
        Profile
      </AppDropdownMenuItem>
      <AppDropdownMenuItem
        icon={<Settings aria-hidden />}
        onSelect={() => router.push(`/w/${membership.workspace.slug}/settings` as Route)}
      >
        Workspace settings
      </AppDropdownMenuItem>
      <AppDropdownMenuSeparator />
      <AppDropdownMenuItem
        icon={<LogOut aria-hidden />}
        onSelect={signOut}
      >
        Sign out
      </AppDropdownMenuItem>
    </AppDropdownMenu>
  );
}
