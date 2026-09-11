"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";

import { AppFormActions, AppFormField } from "@/components/forms/form-field";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppButton } from "@/components/ui/app-button";
import { AppCard } from "@/components/ui/app-card";
import { AppInput } from "@/components/ui/app-input";
import { AppRadio, AppRadioGroup } from "@/components/ui/app-radio";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppSwitch } from "@/components/ui/app-switch";
import { WidgetPreview } from "@/features/chatbots/components/widget-preview";
import { useUpdateChatbotMutation } from "@/features/chatbots/mutations";
import { useChatbotQuery } from "@/features/chatbots/queries";
import { chatbotAppearanceSchema } from "@/features/chatbots/schemas";
import type { Chatbot, ChatbotAppearance } from "@/features/chatbots/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";
import { isApiError } from "@/lib/api/api-error";
import type { z } from "zod";

type FormValues = z.input<typeof chatbotAppearanceSchema>;

function toFormValues(appearance: ChatbotAppearance): FormValues {
  return { ...appearance, avatarUrl: appearance.avatarUrl ?? "" };
}

// Brand swatches the customer picks from, not theme colours: they are stored
// on the chatbot and painted on the visitor's own site, so they never follow
// the operator's light/dark preference.
const PRESET_COLORS = ["#111111", "#333333", "#1d4ed8", "#15803d", "#6d28d9", "#b91c1c", "#b45309"];

function AppearanceForm({ chatbot }: { chatbot: Chatbot }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const update = useUpdateChatbotMutation(chatbot.id);
  const form = useForm<FormValues>({
    resolver: zodResolver(chatbotAppearanceSchema),
    defaultValues: toFormValues(chatbot.appearance),
  });

  // Remounting on updatedAt would discard whatever the user is typing whenever
  // any other mutation touches this record (a status toggle in the header, for
  // instance). Reconcile instead, and only when there is nothing to lose.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(toFormValues(chatbot.appearance));
  }, [chatbot, form]);

  const values = useWatch({ control: form.control });
  const preview: ChatbotAppearance = {
    primaryColor: values.primaryColor && /^#[0-9a-fA-F]{6}$/.test(values.primaryColor) ? values.primaryColor : chatbot.appearance.primaryColor,
    theme: values.theme ?? chatbot.appearance.theme,
    position: values.position ?? chatbot.appearance.position,
    launcherLabel: values.launcherLabel || "Chat",
    avatarUrl: values.avatarUrl ? values.avatarUrl : null,
    showBranding: values.showBranding ?? chatbot.appearance.showBranding,
  };

  const onSubmit = form.handleSubmit((raw) => {
    const parsed = chatbotAppearanceSchema.parse(raw);
    update.mutate(
      { appearance: parsed },
      {
        onSuccess: (updated) => form.reset(toFormValues(updated.appearance)),
        onError: (error) => {
          if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
        },
      },
    );
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-5">
      <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5 lg:col-span-3">
        <AppCard padding="md" className="flex flex-col gap-5">
          <AppFormField label="Brand color" error={form.formState.errors.primaryColor?.message} description="Used for the header, launcher and visitor messages.">
            {(field) => (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5" role="group" aria-label="Preset colors">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => form.setValue("primaryColor", color, { shouldDirty: true })}
                      aria-label={`Use ${color}`}
                      aria-pressed={values.primaryColor === color}
                      className="size-7 rounded-full border border-border ring-offset-2 ring-offset-surface focus-ring aria-pressed:ring-2 aria-pressed:ring-ring"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <AppInput {...field} {...form.register("primaryColor")} className="w-32 font-mono uppercase" maxLength={7} />
              </div>
            )}
          </AppFormField>

          <AppRadioGroup legend="Theme">
            <div className="flex flex-wrap gap-6">
              <AppRadio id="theme-light" value="light" {...form.register("theme")} label="Light" />
              <AppRadio id="theme-dark" value="dark" {...form.register("theme")} label="Dark" />
            </div>
          </AppRadioGroup>

          <AppRadioGroup legend="Launcher position">
            <div className="flex flex-wrap gap-6">
              <AppRadio id="pos-right" value="bottom-right" {...form.register("position")} label="Bottom right" />
              <AppRadio id="pos-left" value="bottom-left" {...form.register("position")} label="Bottom left" />
            </div>
          </AppRadioGroup>

          <AppFormField label="Launcher label" error={form.formState.errors.launcherLabel?.message} required>
            {(field) => <AppInput {...field} {...form.register("launcherLabel")} maxLength={40} />}
          </AppFormField>

          <AppFormField label="Avatar URL" optional error={form.formState.errors.avatarUrl?.message} description="Square image, at least 64×64px.">
            {(field) => <AppInput {...field} {...form.register("avatarUrl")} type="url" placeholder="https://example.com/avatar.png" />}
          </AppFormField>

          <AppSwitch
            id="show-branding"
            checked={values.showBranding ?? chatbot.appearance.showBranding}
            onCheckedChange={(checked) => form.setValue("showBranding", checked, { shouldDirty: true })}
            label="Show “Powered by” badge"
            description="Available to remove on paid plans."
            disabled={!editable}
          />
        </AppCard>
        {editable ? (
          <AppFormActions>
            <AppButton type="button" variant="secondary" onClick={() => form.reset(toFormValues(chatbot.appearance))} disabled={!form.formState.isDirty || update.isPending}>
              Discard
            </AppButton>
            <AppButton type="submit" loading={update.isPending} disabled={!form.formState.isDirty}>
              Save appearance
            </AppButton>
          </AppFormActions>
        ) : null}
      </fieldset>
      <div className="lg:col-span-2">
        <p className="mb-2 text-sm font-medium">Live preview</p>
        <WidgetPreview appearance={preview} name={chatbot.name} welcomeMessage={chatbot.welcomeMessage} />
      </div>
    </form>
  );
}

export function ChatbotAppearanceForm({ chatbotId }: { chatbotId: string }) {
  const query = useChatbotQuery(chatbotId);
  if (query.isPending) return <AppSkeleton className="h-96" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <AppearanceForm key={query.data.id} chatbot={query.data} />;
}
