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
import { signUpWithInvitationAction, signUpWithInvitationFirebaseAction } from "@/features/auth/actions";
import { AuthDivider, GoogleAuthButton } from "@/features/auth/components/google-auth-button";
import { createFirebaseAccount, firebaseErrorMessage, signInWithGoogle } from "@/features/auth/firebase-client";
import { invitedSignUpSchema, type InvitedSignUpInput } from "@/features/auth/schemas";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

/**
 * Sign-up for someone who arrived from an invitation.
 *
 * A sibling of `SignUpForm` rather than a mode of it: this one has no
 * organization field (the invitation names one), a fixed email (the invitation
 * was issued to it), and a different action. Sharing one component would mean
 * a schema union and three conditionals in the markup to save a page of JSX.
 *
 * The email input is read-only rather than hidden so the person can see which
 * address they are about to register - and the server checks it against the
 * invitation regardless, so editing it in devtools changes nothing.
 */
export function InvitedSignUpForm({ token, email }: { token: string; email: string }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [googlePending, startGoogle] = useTransition();
  const firebaseEnabled = isFirebaseAuthEnabled();
  const form = useForm<InvitedSignUpInput>({
    resolver: zodResolver(invitedSignUpSchema),
    defaultValues: { name: "", email, password: "", invitationToken: token },
  });

  /**
   * Accepting an invitation with Google.
   *
   * No organization name is needed - the invitation names one - so this is the
   * simplest of the three Google paths. The address is not checked here on
   * purpose: `claimInvitation` compares the invitation against the address in
   * the VERIFIED token and refuses a mismatch by name ("This invitation was
   * sent to ..."), which is both the security boundary and the more useful
   * message. Checking it in the browser first would only duplicate it.
   */
  function continueWithGoogle() {
    setServerError(null);
    startGoogle(async () => {
      let idToken: string;
      try {
        ({ idToken } = await signInWithGoogle());
      } catch (error) {
        const message = firebaseErrorMessage(error);
        if (message) setServerError(message);
        return;
      }
      const result = await signUpWithInvitationFirebaseAction({ idToken, invitationToken: token });
      if (result && !result.ok) setServerError(result.error);
    });
  }

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      if (firebaseEnabled) {
        let idToken: string;
        try {
          // `values.email` is the invitation's address, and the field is
          // read-only - but this is not where that is enforced. The server
          // re-checks the invitation against the address in the verified
          // token, so a tampered field produces a refusal there, not an
          // account in the wrong organization.
          ({ idToken } = await createFirebaseAccount({ email: values.email, password: values.password, name: values.name }));
        } catch (error) {
          setServerError(firebaseErrorMessage(error));
          return;
        }
        const result = await signUpWithInvitationFirebaseAction({
          idToken,
          name: values.name,
          invitationToken: values.invitationToken,
        });
        if (result && !result.ok) {
          setServerError(result.error);
          applyFieldErrors(form.setError, result.fieldErrors);
        }
        return;
      }

      const result = await signUpWithInvitationAction(values);
      if (result && !result.ok) {
        setServerError(result.error);
        applyFieldErrors(form.setError, result.fieldErrors);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {serverError ? <AppAlert tone="danger">{serverError}</AppAlert> : null}
      <input type="hidden" {...form.register("invitationToken")} />
      {firebaseEnabled ? (
        <>
          <GoogleAuthButton
            label={`Join with Google`}
            pending={googlePending}
            disabled={pending}
            onClick={continueWithGoogle}
          />
          <AuthDivider label="or with email" />
        </>
      ) : null}
      <AppFormField label="Your name" error={form.formState.errors.name?.message} required>
        {(field) => (
          <AppInput {...field} {...form.register("name")} autoComplete="name" placeholder="Ada Lovelace" autoFocus />
        )}
      </AppFormField>
      <AppFormField
        label="Work email"
        description="The address this invitation was sent to."
        error={form.formState.errors.email?.message}
        required
      >
        {(field) => <AppInput {...field} {...form.register("email")} type="email" readOnly />}
      </AppFormField>
      <AppFormField
        label="Password"
        description="At least 8 characters."
        error={form.formState.errors.password?.message}
        required
      >
        {(field) => (
          <AppPasswordInput
            {...field}
            {...form.register("password")}
            autoComplete="new-password"
            placeholder="Create a password"
          />
        )}
      </AppFormField>
      <AppButton type="submit" fullWidth loading={pending} disabled={googlePending} size="lg">
        Create account and join
      </AppButton>
      <p className="text-center text-sm text-foreground-muted">
        Already have an account?{" "}
        <Link
          href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
