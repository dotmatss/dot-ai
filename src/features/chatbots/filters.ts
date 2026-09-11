import { CHATBOT_STATUSES, type ChatbotListFilters, type ChatbotStatus } from "@/features/chatbots/types";
import { DEFAULT_PAGE_SIZE } from "@/types/pagination";

/**
 * Normalizes raw URL parameters into list filters. Shared by the server page
 * (for prefetching) and the client list so both sides derive identical query keys.
 */
export function parseChatbotFilters(values: Record<string, string | string[] | undefined>): ChatbotListFilters {
  const raw = (key: string) => {
    const value = values[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const statusValue = raw("status");
  const status = statusValue && (CHATBOT_STATUSES as readonly string[]).includes(statusValue) ? (statusValue as ChatbotStatus) : undefined;
  const page = Number(raw("page") ?? 1);
  const q = raw("q")?.trim();
  return {
    q: q || undefined,
    status,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}
