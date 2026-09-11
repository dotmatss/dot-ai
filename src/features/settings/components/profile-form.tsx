"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppFormActions, AppFormField, AppFormSection } from "@/components/forms/form-field";
import { AppAvatar } from "@/components/ui/app-avatar";
import { AppButton } from "@/components/ui/app-button";
import { AppInput } from "@/components/ui/app-input";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppText } from "@/components/ui/app-typography";
import { useUpdateProfileMutation } from "@/features/settings/mutations";
import { useUserProfileQuery } from "@/features/settings/queries";
import { avatarUrlFieldSchema, profileFormSchema, type ProfileFormValues } from "@/features/settings/schemas";
import type { UserProfile } from "@/features/settings/types";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

function toFormValues(profile: UserProfile): ProfileFormValues {
  return { name: profile.name, avatarUrl: profile.avatarUrl ?? "" };
}

function ProfileFields({ profile }: { profile: UserProfile }) {
  const router = useRouter();
  const update = useUpdateProfileMutation();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: toFormValues(profile),
  });

  useEffect(() => {
    if (!form.formState.isDirty) form.reset(toFormValues(profile));
  }, [profile, form]);

  const name = useWatch({ control: form.control, name: "name" });
  const avatarUrl = useWatch({ control: form.control, name: "avatarUrl" });
  // The preview uses the same schema the server will: a half-typed or
  // javascript: URL simply has no preview rather than reaching an <img src>.
  const previewSrc = avatarUrlFieldSchema.safeParse(avatarUrl).data || null;

  const onSubmit = form.handleSubmit((values) => {
    update.mutate(
      { name: values.name, avatarUrl: values.avatarUrl },
      {
        onSuccess: (updated) => {
          form.reset(toFormValues(updated));
          // The topbar avatar and name come from the server layout.
          router.refresh();
        },
        onError: (error) => {
          if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
        },
      },
    );
  });

  return (
    <>
      <form onSubmit={onSubmit} noValidate>
        <AppFormSection title="Your profile" description="How you appear to the rest of your organization.">
          <div className="flex items-center gap-4">
            <AppAvatar name={name || profile.name} src={previewSrc} size="lg" />
            <AppText size="sm" tone="muted">
              Your avatar is loaded from the link below. Without one, your initials are used.
            </AppText>
          </div>
          <AppFormField label="Name" required error={form.formState.errors.name?.message}>
            {(field) => <AppInput {...field} {...form.register("name")} autoComplete="name" />}
          </AppFormField>
          <AppFormField
            label="Avatar URL"
            optional
            error={form.formState.errors.avatarUrl?.message}
            description="A public https:// link to an image. Leave empty to use your initials."
          >
            {(field) => (
              <AppInput
                {...field}
                {...form.register("avatarUrl")}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://example.com/avatar.png"
              />
            )}
          </AppFormField>
          <AppFormActions>
            <AppButton type="submit" loading={update.isPending} disabled={!form.formState.isDirty}>
              Save changes
            </AppButton>
          </AppFormActions>
        </AppFormSection>
      </form>

      <AppFormSection
        title="Sign-in email"
        description="Your email is your login identity. Changing it is an authentication change, not a profile edit, so it is not editable here."
      >
        <AppFormField label="Email">
          {(field) => <AppInput {...field} value={profile.email} readOnly autoComplete="email" />}
        </AppFormField>
      </AppFormSection>
    </>
  );
}

export function ProfileForm() {
  const query = useUserProfileQuery();
  if (query.isPending) return <AppSkeleton className="h-96 rounded-lg" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <ProfileFields key={query.data.id} profile={query.data} />;
}
