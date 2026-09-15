"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { syncEmailVerificationAction } from "@/features/auth/actions";
import { firebaseErrorMessage, refreshVerificationState, sendVerificationEmail } from "@/features/auth/firebase-client";

type Notice = { tone: "success" | "danger" | "info"; text: string } | null;

/**
 * The verification waiting room.
 *
 * ── Why there is a button and not a poll ────────────────────────────────────
 *
 * The person clicks the link in their mail client, usually in another tab or on
 * their phone, and this tab has no way to hear about it: verification happens
 * between them and Firebase. So the page asks. A background poll would work
 * too, and would spend a Firebase call every few seconds per idle tab for an
 * event that arrives once.
 *
 * ── Why the client cannot just say "verified" ───────────────────────────────
 *
 * `refreshVerificationState` re-reads the user FROM Firebase and forces a new
 * ID token carrying the current `email_verified` claim. That token goes to the
 * server, which verifies its signature against Google's keys before writing
 * anything - so the `emailVerified` boolean below decides what this component
 * renders, and nothing else. Setting it in devtools re-renders a page; it does
 * not verify an address, because the server never reads it.
 */
export function VerifyEmailPanel({ email }: { email: string }) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [checking, startChecking] = useTransition();
  const [resending, startResending] = useTransition();

  function check() {
    setNotice(null);
    startChecking(async () => {
      let refreshed: Awaited<ReturnType<typeof refreshVerificationState>>;
      try {
        refreshed = await refreshVerificationState();
      } catch (error) {
        setNotice({ tone: "danger", text: firebaseErrorMessage(error) });
        return;
      }
      if (!refreshed) {
        // The application session outlived the Firebase one - a different
        // browser, or cleared site data. Signing in again mints both.
        setNotice({ tone: "danger", text: "Your sign-in has expired here. Sign in again to continue." });
        return;
      }

      const result = await syncEmailVerificationAction(refreshed.idToken);
      if (!result.ok) {
        setNotice({ tone: "danger", text: result.error });
        return;
      }
      if (result.data?.emailVerified) {
        // The gate reads `users.email_verified` on the server, which the action
        // has just updated; refreshing re-runs it and lets the redirect through.
        router.refresh();
        return;
      }
      setNotice({ tone: "info", text: "Not verified yet. Click the link in the email, then check again." });
    });
  }

  function resend() {
    setNotice(null);
    startResending(async () => {
      try {
        await sendVerificationEmail();
        setNotice({ tone: "success", text: `Verification email sent to ${email}.` });
      } catch (error) {
        setNotice({ tone: "danger", text: firebaseErrorMessage(error) });
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {notice ? <AppAlert tone={notice.tone}>{notice.text}</AppAlert> : null}
      <div className="flex flex-col gap-3">
        <AppButton type="button" fullWidth size="lg" loading={checking} onClick={check}>
          I&rsquo;ve verified — continue
        </AppButton>
        <AppButton type="button" fullWidth variant="secondary" loading={resending} onClick={resend}>
          Resend verification email
        </AppButton>
      </div>
    </div>
  );
}
