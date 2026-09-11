"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import { AppDropdownMenu, AppDropdownMenuItem, AppDropdownMenuLabel, AppDropdownMenuSeparator } from "@/components/ui/app-dropdown-menu";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { cn } from "@/lib/cn";

export function WorkspaceSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { membership, workspaces } = useWorkspace();
  const router = useRouter();
  const current = membership.workspace;

  return (
    <AppDropdownMenu
      align="start"
      label="Switch workspace"
      className="min-w-60"
      trigger={
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md border border-transparent text-left transition-colors hover:bg-surface-muted focus-ring",
            collapsed ? "justify-center p-1.5" : "px-2 py-1.5",
          )}
          aria-label={collapsed ? `Workspace: ${current.name}` : undefined}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold text-accent-foreground">
            {current.name.slice(0, 1).toUpperCase()}
          </span>
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold leading-4">{current.name}</span>
                <span className="block truncate text-caption text-foreground-muted">{membership.organization.name}</span>
              </span>
              <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-foreground-subtle" />
            </>
          ) : null}
        </button>
      }
    >
      <AppDropdownMenuLabel>Workspaces</AppDropdownMenuLabel>
      {workspaces.map((item) => (
        <AppDropdownMenuItem
          key={item.workspace.id}
          onSelect={() => router.push(`/w/${item.workspace.slug}/dashboard` as Route)}
          icon={
            <span className="flex size-4 items-center justify-center">
              {item.workspace.id === current.id ? <Check aria-hidden /> : null}
            </span>
          }
        >
          <span className="flex flex-col">
            <span>{item.workspace.name}</span>
            <span className="text-caption text-foreground-muted">{item.organization.name}</span>
          </span>
        </AppDropdownMenuItem>
      ))}
      <AppDropdownMenuSeparator />
      <AppDropdownMenuItem icon={<Plus aria-hidden />} onSelect={() => router.push("/onboarding")}>
        New workspace
      </AppDropdownMenuItem>
    </AppDropdownMenu>
  );
}
