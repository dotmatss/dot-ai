import { AppBadge } from "@/components/ui/app-badge";
import { CHATBOT_STATUS_META } from "@/features/chatbots/constants";
import type { ChatbotStatus } from "@/features/chatbots/types";

export function ChatbotStatusBadge({ status, size }: { status: ChatbotStatus; size?: "sm" | "md" }) {
  const meta = CHATBOT_STATUS_META[status];
  return (
    <AppBadge tone={meta.tone} dot size={size}>
      {meta.label}
    </AppBadge>
  );
}
