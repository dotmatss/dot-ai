import {
  CONVERSATION_CHANNELS,
  CONVERSATION_STATUSES,
  type ConversationChannel,
  type ConversationListFilters,
  type ConversationStatus,
} from "@/features/conversations/types";
import { DEFAULT_PAGE_SIZE } from "@/types/pagination";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;

function first(values: RawParams, key: string): string | undefined {
  const value = values[key];
  return Array.isArray(value) ? value[0] : value;
}

function uuidOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && UUID_PATTERN.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

/** URL keys the inbox reads and writes. */
export const CONVERSATION_FILTER_KEYS = ["q", "status", "channel", "chatbotId", "agentId", "contactId", "assignedTo", "page"] as const;
export type ConversationFilterKey = (typeof CONVERSATION_FILTER_KEYS)[number];

const ADJUSTABLE_KEYS: ReadonlyArray<keyof ConversationListFilters> = ["q", "status", "channel", "chatbotId", "agentId", "contactId", "assignedTo"];

/**
 * Normalizes raw URL parameters into list filters. Shared by the server page
 * (for prefetching) and the client table so both derive identical query keys.
 * `fixed` filters (e.g. `{ chatbotId }` when embedded in a chatbot page) always
 * win over URL values.
 */
export function parseConversationFilters(values: RawParams, fixed: Partial<ConversationListFilters> = {}): ConversationListFilters {
  const statusValue = first(values, "status");
  const status =
    statusValue && (CONVERSATION_STATUSES as readonly string[]).includes(statusValue) ? (statusValue as ConversationStatus) : undefined;

  const channelValue = first(values, "channel");
  const channel =
    channelValue && (CONVERSATION_CHANNELS as readonly string[]).includes(channelValue) ? (channelValue as ConversationChannel) : undefined;

  const assignedRaw = first(values, "assignedTo")?.trim();
  const assignedTo = assignedRaw === "me" ? "me" : uuidOrUndefined(assignedRaw);

  const page = Number(first(values, "page") ?? 1);
  const q = first(values, "q")?.trim();

  const filters: ConversationListFilters = {
    q: q || undefined,
    status,
    channel,
    chatbotId: uuidOrUndefined(first(values, "chatbotId")),
    agentId: uuidOrUndefined(first(values, "agentId")),
    contactId: uuidOrUndefined(first(values, "contactId")),
    assignedTo,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };

  return { ...filters, ...definedEntries(fixed) };
}

/** True when any user-adjustable filter (one not fixed by the host page) is active. */
export function hasActiveConversationFilters(filters: ConversationListFilters, fixed: Partial<ConversationListFilters> = {}): boolean {
  return ADJUSTABLE_KEYS.some((key) => fixed[key] === undefined && filters[key] !== undefined);
}

function definedEntries<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
