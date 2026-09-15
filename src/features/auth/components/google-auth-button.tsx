"use client";

import type { ReactNode } from "react";

import { AppButton } from "@/components/ui/app-button";

/**
 * Google's mark, inline.
 *
 * Inline rather than an <img> because the CDN allowlist and the CSP would have
 * to grow a host for a 1 KB asset, and because an icon that fails to load
 * leaves a "Continue with" button with nothing to continue with.
 *
 * The four brand colours are fixed values, not theme tokens: they are Google's
 * and must not shift with our palette in dark mode.
 */
function GoogleMark(): ReactNode {
  return (
    <svg viewBox="0 0 18 18" aria-hidden className="size-[18px] shrink-0">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path fill="#FBBC05" d="M3.95 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33Z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * "Continue with Google", shared by sign-in and sign-up.
 *
 * Deliberately dumb: it renders and reports clicks. What a click MEANS differs
 * between the two pages - on sign-in it may never create an account, on sign-up
 * it may - and putting that decision behind one button would hide the single
 * most important difference between the two flows. Each page passes its own
 * handler.
 */
export function GoogleAuthButton({
  label,
  pending,
  disabled,
  onClick,
}: {
  label: string;
  pending: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <AppButton
      type="button"
      variant="secondary"
      fullWidth
      size="lg"
      loading={pending}
      disabled={disabled}
      onClick={onClick}
      // `leadingIcon` rather than a child: AppButton swaps it for the spinner
      // while loading, so the mark does not sit next to one.
      leadingIcon={<GoogleMark />}
    >
      {label}
    </AppButton>
  );
}

/** A labelled rule between the provider buttons and the credential form. */
export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs uppercase tracking-wide text-foreground-subtle">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
