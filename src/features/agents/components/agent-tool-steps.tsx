"use client";

import { Wrench } from "lucide-react";

import { AppBadge } from "@/components/ui/app-badge";
import { TOOL_CALL_STATUS_META } from "@/features/agents/constants";
import { findAgentTool } from "@/features/agents/tools/registry";
import type { AgentToolCallRecord, AgentToolCallStatus } from "@/features/agents/types";
import type { ChatToolActivity } from "@/hooks/use-chat-stream";

const TOOL_CALL_STATUSES: readonly AgentToolCallStatus[] = [
  "executed",
  "simulated",
  "approval_required",
  "unavailable",
  "unknown_tool",
];

function formatArguments(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * Turns the opaque tool activity the shared chat hook collects into the agent
 * domain's record. The payload comes from the model through the gateway, so it
 * is validated rather than trusted.
 */
export function toToolCallRecords(activity: ChatToolActivity[]): AgentToolCallRecord[] {
  const records: AgentToolCallRecord[] = [];
  for (const entry of activity) {
    if (entry.kind !== "result") continue;
    const value = entry.result as Record<string, unknown> | null;
    if (!value || typeof value !== "object") continue;
    if (typeof value.toolId !== "string" || typeof value.reason !== "string") continue;
    if (!TOOL_CALL_STATUSES.includes(value.status as AgentToolCallStatus)) continue;
    records.push({
      id: entry.id,
      toolId: value.toolId,
      status: value.status as AgentToolCallStatus,
      message: value.reason,
      arguments: value.arguments,
    });
  }
  return records;
}

/**
 * One tool request the model made. Agents never execute tools, so the step
 * reports the decision and its reason; the badge tone always sits next to a
 * text label, so status is never carried by colour alone.
 */
function ToolStep({ record }: { record: AgentToolCallRecord }) {
  const meta = TOOL_CALL_STATUS_META[record.status];
  const definition = findAgentTool(record.toolId);
  const args = formatArguments(record.arguments);
  return (
    <li className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Wrench aria-hidden className="size-3.5 text-foreground-subtle" />
        <span className="text-xs font-medium">{definition?.name ?? record.toolId}</span>
        <AppBadge tone={meta.tone} size="sm" dot>
          {meta.label}
        </AppBadge>
      </div>
      <p className="mt-1 text-xs text-foreground-muted">{record.message}</p>
      {args ? (
        <p className="mt-1 truncate font-mono text-caption text-foreground-subtle" title={args}>
          {args}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The tool activity block shown above an agent's reply. For an agent this is
 * the most important part of the transcript: it is where the reader sees what
 * the model wanted to do and why it was not carried out.
 */
export function AgentToolSteps({ activity, agentName }: { activity: ChatToolActivity[]; agentName: string }) {
  const records = toToolCallRecords(activity);
  if (records.length === 0) return null;
  return (
    <ul className="flex w-full max-w-[85%] flex-col gap-1.5" aria-label={`Tool activity from ${agentName}`}>
      {records.map((record) => (
        <ToolStep key={record.id} record={record} />
      ))}
    </ul>
  );
}
