"use client";

import { Send, Square } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

import { AppButton } from "@/components/ui/app-button";
import { cn } from "@/lib/cn";

interface ChatComposerProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  accentColor?: string;
  className?: string;
  /** Visible label text for assistive technology. Defaults to "Message". */
  label?: string;
  autoFocus?: boolean;
}

export function ChatComposer({
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder = "Type a message…",
  accentColor,
  className,
  label = "Message",
  autoFocus,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  // Generated rather than fixed: two composers on one page (a playground and
  // the public demo, say) would otherwise share an id, and the label would
  // point at whichever textarea rendered first.
  const inputId = useId();

  function submit() {
    const text = value.trim();
    if (!text || streaming || disabled) return;
    onSend(text);
    setValue("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={cn("flex items-end gap-2 rounded-lg border border-border bg-surface p-2 shadow-xs focus-within:border-foreground", className)}
    >
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <textarea
        id={inputId}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-6 outline-none placeholder:text-foreground-subtle disabled:text-foreground-subtle field-sizing-content"
      />
      {streaming && onStop ? (
        <AppButton type="button" variant="secondary" size="icon" onClick={onStop} aria-label="Stop generating">
          <Square aria-hidden className="fill-current" />
        </AppButton>
      ) : (
        <AppButton
          type="submit"
          size="icon"
          disabled={disabled || value.trim().length === 0}
          aria-label="Send message"
          style={accentColor ? { backgroundColor: accentColor } : undefined}
        >
          <Send aria-hidden />
        </AppButton>
      )}
    </form>
  );
}
