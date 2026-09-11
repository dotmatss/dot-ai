import { AppBadge } from "@/components/ui/app-badge";
import { CONVERSATION_CHANNEL_META, CONVERSATION_STATUS_META } from "@/features/conversations/constants";
import type { ConversationChannel, ConversationStatus } from "@/features/conversations/types";

export function ConversationStatusBadge({ status, size }: { status: ConversationStatus; size?: "sm" | "md" }) {
  const meta = CONVERSATION_STATUS_META[status];
  return (
    <AppBadge tone={meta.tone} dot size={size}>
      {meta.label}
    </AppBadge>
  );
}

/**
 * Channel is provenance, not state, so it stays on the neutral outline badge:
 * the status tones are reserved for what a reader has to act on.
 */
export function ConversationChannelBadge({ channel, size }: { channel: ConversationChannel; size?: "sm" | "md" }) {
  const meta = CONVERSATION_CHANNEL_META[channel];
  return (
    <AppBadge tone="neutral" variant="outline" size={size} title={meta.description}>
      {meta.label}
    </AppBadge>
  );
}
