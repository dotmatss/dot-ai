"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { AppInput, AppPasswordInput } from "@/components/ui/app-input";
import { signUpAction } from "@/features/auth/actions";
import { signUpSchema, type SignUpInput } from "@/features/auth/schemas";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

export function SignUpForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", organizationName: "", email: "", password: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
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
      <AppFormField label="Your name" error={form.formState.errors.name?.message} required>
        {(field) => <AppInput {...field} {...form.register("name")} autoComplete="name" placeholder="Ada Lovelace" autoFocus />}
      </AppFormField>
      <AppFormField
        label="Organization"
        description="Your company or team. A workspace with the same name is created for you."
        error={form.formState.errors.organizationName?.message}
        required
      >
        {(field) => <AppInput {...field} {...form.register("organizationName")} autoComplete="organization" placeholder="Acme Inc." />}
      </AppFormField>
      <AppFormField label="Work email" error={form.formState.errors.email?.message} required>
        {(field) => <AppInput {...field} {...form.register("email")} type="email" autoComplete="email" placeholder="you@company.com" />}
      </AppFormField>
      <AppFormField
        label="Password"
        description="At least 8 characters."
        error={form.formState.errors.password?.message}
        required
      >
        {(field) => <AppPasswordInput {...field} {...form.register("password")} autoComplete="new-password" placeholder="Create a password" />}
      </AppFormField>
      <AppButton type="submit" fullWidth loading={pending} size="lg">
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
