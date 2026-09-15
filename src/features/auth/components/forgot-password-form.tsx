"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AppFormField } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { AppInput } from "@/components/ui/app-input";
import { firebaseErrorMessage, sendFirebasePasswordReset } from "@/features/auth/firebase-client";
import { emailSchema } from "@/features/auth/schemas";

const forgotPasswordSchema = z.object({ email: emailSchema });
type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * Password reset, entirely Firebase's.
 *
 * There is no server action here and no route handler behind it: the browser
 * asks Firebase to send the email, Firebase owns the token, the link, the
 * expiry and the page that accepts the new password. That is what §15 asks
 * for, and it is also why this application stores no reset tokens - the
 * safest reset token is the one that is not in our database.
 *
 * ── Why it always says the same thing ───────────────────────────────────────
 *
 * Success is reported whether or not an account exists. Firebase's own error
 * for an unknown address would otherwise turn this form into an address
 * checker: type an address, read the error, learn whether that person has an
 * account here. The person who owns the address gets the email either way, and
 * the person who does not learns nothing.
 *
 * Errors that are NOT about the address - a rate limit, no network - are still
 * shown, because they are about this request rather than about who exists.
 */
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      try {
        await sendFirebasePasswordReset(values.email);
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
        // `user-not-found` and `invalid-email` are answers about who exists.
        // Everything else is about this request and is worth reporting.
        if (code !== "auth/user-not-found" && code !== "auth/invalid-email") {
          setServerError(firebaseErrorMessage(error));
          return;
        }
      }
      setSent(true);
    });
  });

  if (sent) {
    return (
      <div className="flex flex-col gap-5">
        <AppAlert tone="success">
          If an account exists for that address, a password reset link is on its way. The link expires after a short time.
        </AppAlert>
        <p className="text-sm text-foreground-muted">
          Nothing in your inbox? Check the spam folder, then{" "}
          <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => setSent(false)}>
            try another address
          </button>
          .
        </p>
        <Link href="/sign-in" className="text-center text-sm font-medium text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {serverError ? <AppAlert tone="danger">{serverError}</AppAlert> : null}
      <AppFormField label="Email" error={form.formState.errors.email?.message} required>
        {(field) => (
          <AppInput {...field} {...form.register("email")} type="email" autoComplete="email" placeholder="you@company.com" autoFocus />
        )}
      </AppFormField>
      <AppButton type="submit" fullWidth loading={pending} size="lg">
        Send reset link
      </AppButton>
      <p className="text-center text-sm text-foreground-muted">
        Remembered it?{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
