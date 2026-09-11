"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { AppInput, AppPasswordInput } from "@/components/ui/app-input";
import { signInAction } from "@/features/auth/actions";
import { signInSchema, type SignInInput } from "@/features/auth/schemas";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

export function SignInForm({ next }: { next?: string }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "", next },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
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
