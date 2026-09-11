export const CHATBOT_STATUSES = ["draft", "active", "paused", "archived"] as const;
export type ChatbotStatus = (typeof CHATBOT_STATUSES)[number];

export interface ChatbotModelConfig {
  /** Model identifier understood by the AI gateway; null uses the gateway default. */
  model: string | null;
  temperature: number;
  maxTokens: number;
}

export interface ChatbotAppearance {
  primaryColor: string;
  theme: "light" | "dark";
  position: "bottom-right" | "bottom-left";
  launcherLabel: string;
  avatarUrl: string | null;
  showBranding: boolean;
}

export interface ChatbotSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ChatbotStatus;
  conversationCount: number;
  collectionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Chatbot extends ChatbotSummary {
  workspaceId: string;
  instructions: string;
  welcomeMessage: string;
  modelConfig: ChatbotModelConfig;
  appearance: ChatbotAppearance;
  allowedDomains: string[];
  embedKey: string;
  collectionIds: string[];
}

export interface ChatbotListFilters {
  q?: string;
  status?: ChatbotStatus;
  page?: number;
  pageSize?: number;
}

export interface ChatbotKnowledgeOption {
  id: string;
  name: string;
  status: string;
  sourceCount: number;
  attached: boolean;
}

export interface ChatbotRecentConversation {
  id: string;
  title: string | null;
  status: string;
  channel: string;
  messageCount: number;
  lastMessageAt: string | null;
}

export interface ChatbotOverview {
  conversationsLast7Days: number;
  conversationsPrevious7Days: number;
  messagesLast7Days: number;
  messagesPrevious7Days: number;
  recentConversations: ChatbotRecentConversation[];
}
