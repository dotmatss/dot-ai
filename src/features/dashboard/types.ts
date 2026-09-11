export interface DashboardStats {
  activeChatbots: number;
  totalChatbots: number;
  conversationsLast7Days: number;
  conversationsPrevious7Days: number;
  messagesLast7Days: number;
  messagesPrevious7Days: number;
  contacts: number;
  newContactsLast7Days: number;
  workflowRunsLast7Days: number;
  failedRunsLast7Days: number;
}

export interface DailyCount {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  count: number;
}

export interface UsageSummary {
  dailyMessages: DailyCount[];
  tokensInLast30Days: number;
  tokensOutLast30Days: number;
  messagesLast30Days: number;
}

export interface ActivityEntry {
  id: string;
  actorName: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  summary: string;
  createdAt: string;
}

export interface ChatbotPerformanceRow {
  id: string;
  name: string;
  status: string;
  conversationsLast7Days: number;
  messagesLast7Days: number;
}

export interface KnowledgeStatusSummary {
  knowledgeBases: number;
  ready: number;
  processing: number;
  error: number;
  sources: number;
  sourcesReady: number;
}

export interface WorkflowActivitySummary {
  activeWorkflows: number;
  runsLast7Days: number;
  succeededLast7Days: number;
  failedLast7Days: number;
  recentRuns: Array<{ id: string; workflowId: string; workflowName: string; status: string; startedAt: string | null; finishedAt: string | null }>;
}

export interface CrmActivitySummary {
  contacts: number;
  leads: number;
  customers: number;
  newLast7Days: number;
  recentContacts: Array<{ id: string; name: string | null; email: string | null; stage: string; createdAt: string }>;
}
