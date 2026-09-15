"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";

import { AppFormActions, AppFormField, AppFormSection } from "@/components/forms/form-field";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppButton } from "@/components/ui/app-button";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppTextarea } from "@/components/ui/app-textarea";
import { ChatbotAiSourceForm, ManagedByAgentNotice } from "@/features/chatbots/components/chatbot-ai-source-form";
import { DEFAULT_INSTRUCTIONS_PLACEHOLDER, MODEL_OPTIONS } from "@/features/chatbots/constants";
import { useUpdateChatbotMutation } from "@/features/chatbots/mutations";
import { useChatbotQuery } from "@/features/chatbots/queries";
import { chatbotInstructionsFormSchema, type ChatbotInstructionsFormValues } from "@/features/chatbots/schemas";
import type { Chatbot } from "@/features/chatbots/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";
import { isApiError } from "@/lib/api/api-error";

function toFormValues(chatbot: Chatbot): ChatbotInstructionsFormValues {
  return {
    instructions: chatbot.instructions,
    welcomeMessage: chatbot.welcomeMessage,
    model: chatbot.modelConfig.model ?? "",
    temperature: chatbot.modelConfig.temperature,
    maxTokens: chatbot.modelConfig.maxTokens,
  };
}

function InstructionsForm({ chatbot }: { chatbot: Chatbot }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const update = useUpdateChatbotMutation(chatbot.id);
  /**
   * When an agent is deployed here, its instructions and model are what run.
   * The chatbot's own values still exist (and come back if it is unlinked), but
   * showing them as editable fields would offer a control that changes nothing.
   */
  const agentBacked = Boolean(chatbot.agentId);
  const form = useForm<ChatbotInstructionsFormValues>({
    resolver: zodResolver(chatbotInstructionsFormSchema),
    defaultValues: toFormValues(chatbot),
  });

  // Remounting on updatedAt would discard whatever the user is typing whenever
  // any other mutation touches this record (a status toggle in the header, for
  // instance). Reconcile instead, and only when there is nothing to lose.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(toFormValues(chatbot));
  }, [chatbot, form]);

  const onSubmit = form.handleSubmit((values) => {
    update.mutate(
      agentBacked
        ? // The welcome message is channel configuration and stays the
          // chatbot's own, so it is the only thing this form still owns.
          { welcomeMessage: values.welcomeMessage }
        : {
            instructions: values.instructions,
            welcomeMessage: values.welcomeMessage,
            modelConfig: { model: values.model || null, temperature: values.temperature, maxTokens: values.maxTokens },
          },
      {
        onSuccess: (updated) => form.reset(toFormValues(updated)),
        onError: (error) => {
          if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
        },
      },
    );
  });

  const instructionsLength = useWatch({ control: form.control, name: "instructions" }).length;

  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset disabled={!editable} className="min-w-0">
        <AppFormSection
          title="Personality & instructions"
          description="Define who the assistant is, what it should do and how it should respond. These instructions are sent as the system prompt on every conversation."
        >
          {agentBacked ? (
            <ManagedByAgentNotice chatbot={chatbot} what="Instructions" />
          ) : (
            <AppFormField
              label="Instructions"
              error={form.formState.errors.instructions?.message}
              description={`${instructionsLength.toLocaleString()} / 20,000 characters`}
            >
              {(field) => (
                <AppTextarea
                  {...field}
                  {...form.register("instructions")}
                  rows={12}
                  placeholder={DEFAULT_INSTRUCTIONS_PLACEHOLDER}
                  className="font-mono text-xs leading-5"
                />
              )}
            </AppFormField>
          )}
          <AppFormField
            label="Welcome message"
            description="The first message visitors see when they open the chat."
            error={form.formState.errors.welcomeMessage?.message}
            required
          >
            {(field) => <AppInput {...field} {...form.register("welcomeMessage")} />}
          </AppFormField>
        </AppFormSection>

        <AppFormSection
          title="Model"
          description="Model routing happens in the AI gateway, so these settings stay portable across providers."
        >
          {agentBacked ? (
            <ManagedByAgentNotice chatbot={chatbot} what="Model configuration" />
          ) : (
            <>
              <AppFormField label="Model" error={form.formState.errors.model?.message}>
                {(field) => <AppSelect {...field} {...form.register("model")} options={MODEL_OPTIONS} />}
              </AppFormField>
              <div className="grid gap-5 sm:grid-cols-2">
                <AppFormField
                  label="Temperature"
                  description="0 is focused and deterministic, 2 is highly creative."
                  error={form.formState.errors.temperature?.message}
                >
                  {(field) => <AppInput {...field} {...form.register("temperature", { valueAsNumber: true })} type="number" step="0.1" min={0} max={2} inputMode="decimal" />}
                </AppFormField>
                <AppFormField
                  label="Max response tokens"
                  description="Upper bound for each reply."
                  error={form.formState.errors.maxTokens?.message}
                >
                  {(field) => <AppInput {...field} {...form.register("maxTokens", { valueAsNumber: true })} type="number" step="64" min={64} max={8192} inputMode="numeric" />}
                </AppFormField>
              </div>
            </>
          )}
          {editable ? (
            <AppFormActions>
              <AppButton type="button" variant="secondary" onClick={() => form.reset(toFormValues(chatbot))} disabled={!form.formState.isDirty || update.isPending}>
                Discard
              </AppButton>
              <AppButton type="submit" loading={update.isPending} disabled={!form.formState.isDirty}>
                Save changes
              </AppButton>
            </AppFormActions>
          ) : null}
        </AppFormSection>
      </fieldset>
    </form>
  );
}

export function ChatbotInstructionsForm({ chatbotId }: { chatbotId: string }) {
  const query = useChatbotQuery(chatbotId);
  if (query.isPending) return <AppSkeleton className="h-96" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <>
      {/* Both are keyed on the saved link: switching source changes which
          fields each form owns, and stale local state would keep the old set. */}
      <ChatbotAiSourceForm key={`source:${query.data.agentId ?? "standalone"}`} chatbot={query.data} />
      <InstructionsForm key={`${query.data.id}:${query.data.agentId ?? "standalone"}`} chatbot={query.data} />
    </>
  );
}
