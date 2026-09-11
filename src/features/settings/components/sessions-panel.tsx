"use client";

import { LogOut, MonitorSmartphone } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableMessageRow,
  AppTableRow,
} from "@/components/ui/app-table";
import { AppText } from "@/components/ui/app-typography";
import { useRevokeSessionMutation, useRevokeSessionsMutation } from "@/features/settings/mutations";
import { useUserSessionsQuery } from "@/features/settings/queries";
import type { SessionRevocationResult, UserSessionSummary } from "@/features/settings/types";

const COLUMNS = 5;
const SIGN_IN: Route = "/sign-in";

type PendingAction =
  | { kind: "current"; session: UserSessionSummary }
  | { kind: "others" }
  | { kind: "all" };

const CONFIRM_COPY: Record<PendingAction["kind"], { title: string; description: string; confirmLabel: string }> = {
  current: {
    title: "Sign out this device?",
    description: "You will be signed out immediately and sent back to the sign-in page.",
    confirmLabel: "Sign out",
  },
  others: {
    title: "Sign out every other device?",
    description: "Every session except this one ends immediately. Anyone using them has to sign in again.",
    confirmLabel: "Sign out others",
  },
  all: {
    title: "Sign out everywhere?",
    description: "Every session ends, including this one. You will be sent back to the sign-in page.",
    confirmLabel: "Sign out everywhere",
  },
};

function SessionRow({
  session,
  busy,
  onSignOut,
}: {
  session: UserSessionSummary;
  busy: boolean;
  onSignOut: (session: UserSessionSummary) => void;
}) {
  return (
    <AppTableRow>
      <AppTableCell>
        <span className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
            <MonitorSmartphone aria-hidden className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium text-foreground">{session.deviceLabel}</span>
              {session.isCurrent ? (
                <AppBadge size="sm" tone="neutral" variant="outline">
                  This device
                </AppBadge>
              ) : null}
            </span>
            {/* Truncated by the repository: the raw header is up to 512 characters
                of whatever the client chose to send. */}
            {session.userAgent ? (
              <span className="block truncate text-xs text-foreground-muted">{session.userAgent}</span>
            ) : null}
          </span>
        </span>
      </AppTableCell>
      <AppTableCell className="whitespace-nowrap font-mono text-xs text-foreground-secondary">
        {session.ipAddress ?? <span className="font-sans text-foreground-muted">Unknown</span>}
      </AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        <AppRelativeTime value={session.lastSeenAt} />
      </AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        <AppRelativeTime value={session.expiresAt} />
      </AppTableCell>
      <AppTableCell className="w-32 text-right">
        <AppButton variant="ghost" size="sm" disabled={busy} onClick={() => onSignOut(session)} leadingIcon={<LogOut aria-hidden />}>
          Sign out
          <span className="sr-only"> {session.deviceLabel}</span>
        </AppButton>
      </AppTableCell>
    </AppTableRow>
  );
}

function SessionsTable({ sessions }: { sessions: UserSessionSummary[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const revokeOne = useRevokeSessionMutation();
  const revokeMany = useRevokeSessionsMutation();

  const busy = revokeOne.isPending || revokeMany.isPending;
  const otherCount = sessions.filter((session) => !session.isCurrent).length;

  function afterRevocation(result: SessionRevocationResult) {
    setPending(null);
    // The cookie is already gone server-side; this leaves a page that can no
    // longer load rather than waiting for the next request to fail.
    if (result.currentSessionRevoked) router.replace(SIGN_IN);
  }

  function signOut(session: UserSessionSummary) {
    if (session.isCurrent) {
      setPending({ kind: "current", session });
      return;
    }
    revokeOne.mutate(session.id, { onSuccess: afterRevocation, onError: () => setPending(null) });
  }

  function confirmPending() {
    if (!pending) return;
    if (pending.kind === "current") {
      revokeOne.mutate(pending.session.id, { onSuccess: afterRevocation, onError: () => setPending(null) });
      return;
    }
    revokeMany.mutate(pending.kind, { onSuccess: afterRevocation, onError: () => setPending(null) });
  }

  const copy = pending ? CONFIRM_COPY[pending.kind] : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <AppButton
          variant="secondary"
          size="sm"
          disabled={busy || otherCount === 0}
          onClick={() => setPending({ kind: "others" })}
        >
          Sign out other sessions
        </AppButton>
        <AppButton variant="danger" size="sm" disabled={busy} onClick={() => setPending({ kind: "all" })}>
          Sign out everywhere
        </AppButton>
      </div>

      <AppTableContainer aria-busy={busy || undefined}>
        <AppTable>
          <AppTableHeader>
            <AppTableRow>
              <AppTableHead>Device</AppTableHead>
              <AppTableHead>IP address</AppTableHead>
              <AppTableHead>Last active</AppTableHead>
              <AppTableHead>Expires</AppTableHead>
              <AppTableHead>
                <span className="sr-only">Actions</span>
              </AppTableHead>
            </AppTableRow>
          </AppTableHeader>
          <AppTableBody>
            {sessions.length === 0 ? (
              <AppTableMessageRow colSpan={COLUMNS}>
                <AppEmptyState
                  size="sm"
                  icon={<MonitorSmartphone aria-hidden />}
                  title="No active sessions"
                  description="Sign in again to start a new session."
                />
              </AppTableMessageRow>
            ) : (
              sessions.map((session) => (
                <SessionRow key={session.id} session={session} busy={busy} onSignOut={signOut} />
              ))
            )}
          </AppTableBody>
        </AppTable>
      </AppTableContainer>

      <AppConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        onConfirm={confirmPending}
        title={copy?.title ?? ""}
        description={copy?.description}
        confirmLabel={copy?.confirmLabel}
        destructive
        loading={busy}
      />
    </>
  );
}

export function SessionsPanel() {
  const query = useUserSessionsQuery();

  return (
    <div className="flex flex-col gap-4">
      <AppText size="sm" tone="muted">
        Every device currently signed in to your account. Sessions are stored as a hash, so nothing here reveals a
        token - a device is identified by the browser it reported and the address it connected from.
      </AppText>
      {query.isPending ? (
        <AppListSkeleton rows={3} />
      ) : query.isError ? (
        <AppTableContainer>
          <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />
        </AppTableContainer>
      ) : (
        <SessionsTable sessions={query.data} />
      )}
    </div>
  );
}
