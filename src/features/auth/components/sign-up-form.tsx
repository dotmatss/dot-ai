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
import { signUpAction, signUpWithFirebaseAction } from "@/features/auth/actions";
import { AuthDivider, GoogleAuthButton } from "@/features/auth/components/google-auth-button";
import { createFirebaseAccount, firebaseErrorMessage, signInWithGoogle } from "@/features/auth/firebase-client";
import { signUpSchema, type SignUpInput } from "@/features/auth/schemas";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

/**
 * Registration.
 *
 * With Firebase configured the order is the one §4 sets out, and the order
 * matters: the Firebase account is created FIRST, in the browser, so the
 * password reaches Google and not this server. Firebase then sends its own
 * verification email, and only afterwards does the application hear about any
 * of it - as an ID token it verifies for itself before writing a row.
 *
 * The email and password fields are not sent to our server at all on this
 * path. The action receives the token, the person's name and the organization
 * name, and reads the address out of the verified token.
 */
export function SignUpForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [googlePending, startGoogle] = useTransition();
  const firebaseEnabled = isFirebaseAuthEnabled();
  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", organizationName: "", email: "", password: "" },
  });

  /**
   * Registering with Google.
   *
   * The organization name is validated BEFORE the popup opens, and that
   * ordering is the whole design. Registration here creates an organization
   * and a workspace, Google supplies neither, and the alternatives are both
   * bad: inventing a name from the email domain gives every tenant a name
   * nobody chose, and opening the popup first means authenticating someone and
   * then telling them the form was incomplete - by which point a Firebase
   * account exists and the page has to explain a half-finished state.
   *
   * So: fill in the one field Google cannot provide, then authenticate. No
   * name field is sent - the verified token carries the Google profile name,
   * which is a better source than anything typed here.
   */
  function continueWithGoogle() {
    setServerError(null);
    void form.trigger("organizationName").then((valid) => {
      if (!valid) {
        form.setFocus("organizationName");
        return;
      }
      const organizationName = form.getValues("organizationName");
      startGoogle(async () => {
        let idToken: string;
        try {
          ({ idToken } = await signInWithGoogle());
        } catch (error) {
          const message = firebaseErrorMessage(error);
          if (message) setServerError(message);
          return;
        }
        const result = await signUpWithFirebaseAction({ idToken, organizationName });
        if (result && !result.ok) {
          setServerError(result.error);
          applyFieldErrors(form.setError, result.fieldErrors);
        }
      });
    });
  }

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      if (firebaseEnabled) {
        let idToken: string;
        try {
          ({ idToken } = await createFirebaseAccount({ email: values.email, password: values.password, name: values.name }));
        } catch (error) {
          setServerError(firebaseErrorMessage(error));
          return;
        }
        const result = await signUpWithFirebaseAction({
          idToken,
          name: values.name,
          organizationName: values.organizationName,
        });
        if (result && !result.ok) {
          setServerError(result.error);
          applyFieldErrors(form.setError, result.fieldErrors);
        }
        return;
      }

      const result = await signUpAction(values);
      if (result && !result.ok) {
        setServerError(result.error);
        applyFieldErrors(form.setError, result.fieldErrors);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {serverError ? <AppAlert tone="danger">{serverError}</AppAlert> : null}
      {firebaseEnabled ? (
        <>
          {/*
            Order matters here: the Organization field sits ABOVE this button,
            because `continueWithGoogle` requires it and a control that
            validates a field the eye has not reached yet feels broken.
          */}
          <AppFormField
            label="Organization"
            description="Your company or team. A workspace with the same name is created for you."
            error={form.formState.errors.organizationName?.message}
            required
          >
            {(field) => <AppInput {...field} {...form.register("organizationName")} autoComplete="organization" placeholder="Acme Inc." autoFocus />}
          </AppFormField>
          <GoogleAuthButton
            label="Sign up with Google"
            pending={googlePending}
            disabled={pending}
            onClick={continueWithGoogle}
          />
          <AuthDivider label="or with email" />
        </>
      ) : null}
      <AppFormField label="Your name" error={form.formState.errors.name?.message} required>
        {(field) => <AppInput {...field} {...form.register("name")} autoComplete="name" placeholder="Ada Lovelace" autoFocus={!firebaseEnabled} />}
      </AppFormField>
      {/* Already rendered above the Google button when Firebase is configured. */}
      {firebaseEnabled ? null : (
        <AppFormField
          label="Organization"
          description="Your company or team. A workspace with the same name is created for you."
          error={form.formState.errors.organizationName?.message}
          required
        >
          {(field) => <AppInput {...field} {...form.register("organizationName")} autoComplete="organization" placeholder="Acme Inc." />}
        </AppFormField>
      )}
      <AppFormField label="Work email" error={form.formState.errors.email?.message} required>
        {(field) => <AppInput {...field} {...form.register("email")} type="email" autoComplete="email" placeholder="you@company.com" />}
      </AppFormField>
      <AppFormField
        label="Password"
        description={firebaseEnabled ? "At least 8 characters. We'll email you a link to confirm your address." : "At least 8 characters."}
        error={form.formState.errors.password?.message}
        required
      >
        {(field) => <AppPasswordInput {...field} {...form.register("password")} autoComplete="new-password" placeholder="Create a password" />}
      </AppFormField>
      <AppButton type="submit" fullWidth loading={pending} disabled={googlePending} size="lg">
        Create account
      </AppButton>
      <p className="text-center text-sm text-foreground-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
