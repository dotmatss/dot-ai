"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { AppInput, AppPasswordInput } from "@/components/ui/app-input";
import { isFirebaseAuthEnabled } from "@/config/firebase";
import { signInAction, signInWithFirebaseAction } from "@/features/auth/actions";
import { firebaseErrorMessage, signInToFirebase } from "@/features/auth/firebase-client";
import { signInSchema, type SignInInput } from "@/features/auth/schemas";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

/**
 * One form, two identity providers.
 *
 * Which one runs is decided by configuration, not by the person: with a
 * Firebase project configured the password goes to Firebase and this server
 * receives only an ID token; without one it falls back to the application's own
 * scrypt credentials, which is what keeps local development and the test suite
 * working with no Firebase project at all (ADR 0001).
 *
 * Both paths end in the same place - `createSession` and the same cookie - so
 * nothing downstream of sign-in knows or cares which ran.
 */
export function SignInForm({ next }: { next?: string }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const firebaseEnabled = isFirebaseAuthEnabled();
  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "", next },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      if (firebaseEnabled) {
        let idToken: string;
        try {
          ({ idToken } = await signInToFirebase(values.email, values.password));
        } catch (error) {
          // Firebase's own failures - wrong password, disabled account, rate
          // limit - never reach the server, so they are translated here.
          setServerError(firebaseErrorMessage(error));
          return;
        }
        // Kept outside the try: this action redirects on success, and catching
        // around it would swallow the navigation.
        const result = await signInWithFirebaseAction({ idToken, next: values.next });
        if (result && !result.ok) setServerError(result.error);
        return;
      }

      const result = await signInAction(values);
      if (result && !result.ok) {
        setServerError(result.error);
        applyFieldErrors(form.setError, result.fieldErrors);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {serverError ? <AppAlert tone="danger">{serverError}</AppAlert> : null}
      <AppFormField label="Email" error={form.formState.errors.email?.message} required>
        {(field) => (
          <AppInput
            {...field}
            {...form.register("email")}
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            autoFocus
          />
        )}
      </AppFormField>
      <AppFormField label="Password" error={form.formState.errors.password?.message} required>
        {(field) => <AppPasswordInput {...field} {...form.register("password")} placeholder="Your password" />}
      </AppFormField>
      {/* Only offered where it works. Password reset is Firebase's, and a link
          to it in a deployment without Firebase would be a dead end. */}
      {firebaseEnabled ? (
        <div className="-mt-2 text-right">
          <Link href="/forgot-password" className="text-sm text-foreground-muted underline-offset-4 hover:text-foreground hover:underline">
            Forgot your password?
          </Link>
        </div>
      ) : null}
      <AppButton type="submit" fullWidth loading={pending} size="lg">
        Sign in
      </AppButton>
      <p className="text-center text-sm text-foreground-muted">
        New here?{" "}
        <Link href="/sign-up" className="font-medium text-foreground underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
