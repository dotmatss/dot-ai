"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { CurrentUser, WorkspaceMembership } from "@/features/workspaces/types";

export interface WorkspaceContextValue {
  user: CurrentUser;
  membership: WorkspaceMembership;
  /** All workspaces the user can switch to. */
  workspaces: WorkspaceMembership[];
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * Exposes the server-verified workspace context to Client Components. Values
 * here are for UI decisions only (labels, URLs, hiding controls); authorization
 * is always re-checked on the server.
 */
export function WorkspaceProvider({ value, children }: { value: WorkspaceContextValue; children: ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
