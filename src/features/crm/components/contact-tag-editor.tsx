"use client";

import { Plus, Tag } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

import { AppButton } from "@/components/ui/app-button";
import { AppChip } from "@/components/ui/app-chip";
import { AppInput } from "@/components/ui/app-input";
import { MAX_TAGS_PER_CONTACT } from "@/features/crm/constants";
import { normalizeTag } from "@/features/crm/normalize";
import { AppText } from "@/components/ui/app-typography";

interface ContactTagEditorProps {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Tags already used elsewhere in the workspace, offered as quick picks. */
  suggestions?: string[];
  disabled?: boolean;
  inputId?: string;
  describedBy?: string;
  invalid?: boolean;
}

const SUGGESTION_LIMIT = 6;

/**
 * Editor for the tag array. Tags are normalized here with the same helper the
 * server uses, so what the user sees after adding is exactly what is stored -
 * no surprise re-casing or duplicate after a save.
 */
export function ContactTagEditor({
  value,
  onChange,
  suggestions = [],
  disabled,
  inputId,
  describedBy,
  invalid,
}: ContactTagEditorProps) {
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const suggestionsLabelId = useId();

  const atCapacity = value.length >= MAX_TAGS_PER_CONTACT;

  function add(raw: string) {
    const tag = normalizeTag(raw);
    if (!tag) return;
    if (value.includes(tag)) {
      setMessage(`“${tag}” is already added`);
      setDraft("");
      return;
    }
    if (atCapacity) {
      setMessage(`Up to ${MAX_TAGS_PER_CONTACT} tags per contact`);
      return;
    }
    setMessage(null);
    setDraft("");
    onChange([...value, tag]);
  }

  function remove(tag: string) {
    setMessage(null);
    onChange(value.filter((item) => item !== tag));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      // Enter inside a dialog form would otherwise submit the whole form.
      event.preventDefault();
      add(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && value.length > 0) {
      remove(value[value.length - 1] ?? "");
    }
  }

  const quickPicks = suggestions.filter((tag) => !value.includes(tag)).slice(0, SUGGESTION_LIMIT);

  return (
    <div className="flex flex-col gap-2.5">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <li key={tag}>
              <AppChip
                leadingIcon={<Tag aria-hidden />}
                onRemove={disabled ? undefined : () => remove(tag)}
                removeLabel={`Remove tag ${tag}`}
              >
                {tag}
              </AppChip>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-2">
        <AppInput
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || atCapacity}
          placeholder={atCapacity ? "Tag limit reached" : "Add a tag…"}
          aria-label={inputId ? undefined : "Add a tag"}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className="max-w-56"
        />
        <AppButton
          variant="secondary"
          size="sm"
          onClick={() => add(draft)}
          disabled={disabled || atCapacity || draft.trim().length === 0}
          leadingIcon={<Plus aria-hidden />}
        >
          Add
        </AppButton>
      </div>

      {quickPicks.length > 0 && !atCapacity && !disabled ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <AppText as="span" size="sm" tone="muted" id={suggestionsLabelId}>
            Used in this workspace:
          </AppText>
          <ul className="flex flex-wrap gap-1.5" aria-labelledby={suggestionsLabelId}>
            {quickPicks.map((tag) => (
              <li key={tag}>
                <AppChip onClick={() => add(tag)} leadingIcon={<Plus aria-hidden />}>
                  {tag}
                </AppChip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="text-xs text-foreground-muted empty:hidden">
        {message}
      </p>
    </div>
  );
}
