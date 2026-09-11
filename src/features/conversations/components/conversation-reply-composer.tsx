"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Send } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useForm, useWatch } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppButton } from "@/components/ui/app-button";
import { AppTextarea } from "@/components/ui/app-textarea";
import { TEAM_AUTHOR_LABEL } from "@/features/conversations/constants";
import { useReplyToConversationMutation } from "@/features/conversations/mutations";
import { humanReplySchema, type HumanReplyInput } from "@/features/conversations/schemas";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";
import { formatNumber } from "@/lib/format/number";

const MAX_CHARS = 8000;
/** Only surface the counter when the limit is close enough to matter. */
const COUNTER_THRESHOLD = MAX_CHARS - 500;

interface ConversationReplyComposerProps {
  conversationId: string;
  /** Viewers see the composer disabled rather than hidden, so the limit is legible. */
  canReply: boolean;
}

export function ConversationReplyComposer({ conversationId, canReply }: ConversationReplyComposerProps) {
  const reply = useReplyToConversationMutation(conversationId);
  const form = useForm<HumanReplyInput>({
    resolver: zodResolver(humanReplySchema),
    defaultValues: { content: "" },
  });

  const content = useWatch({ control: form.control, name: "content" });

  const onSubmit = form.handleSubmit((values) => {
    reply.mutate(values, {
      onSuccess: () => form.reset({ content: "" }),
      onError: (error) => {
        if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
      },
    });
  });

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter breaks the line: the convention every chat tool
    // shares, and the thread above is a chat.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void onSubmit();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      <AppFormField
        label={`Reply as ${TEAM_AUTHOR_LABEL}`}
        labelHidden
        error={form.formState.errors.content?.message}
        className="gap-1"
      >
        {(control) => (
          <AppTextarea
            {...control}
            {...form.register("content")}
            rows={3}
            maxLength={MAX_CHARS}
            disabled={!canReply || reply.isPending}
            onKeyDown={onKeyDown}
            placeholder={canReply ? "Write a reply. It is added to the thread as Team." : "Your role does not allow replying."}
          />
        )}
      </AppFormField>
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption text-foreground-muted">
          {canReply
            ? "Sent as your name under the Team label and kept in the model's context."
            : "Viewers can read conversations but cannot reply."}
        </p>
        <div className="flex items-center gap-3">
          {content.length >= COUNTER_THRESHOLD ? (
            <span className="text-caption tabular-nums text-foreground-muted">
              {formatNumber(content.length)} / {formatNumber(MAX_CHARS)}
            </span>
          ) : null}
          <AppButton
            type="submit"
            size="sm"
            leadingIcon={<Send aria-hidden />}
            loading={reply.isPending}
            disabled={!canReply || content.trim().length === 0}
          >
            Send reply
          </AppButton>
        </div>
      </div>
    </form>
  );
}
