import "server-only";

import { SUMMARY_MAX_MESSAGES, SUMMARY_MAX_NOTES, SUMMARY_MAX_OUTPUT_TOKENS } from "@/features/crm/constants";
import { contactDisplayName } from "@/features/crm/normalize";
import {
  findContactById,
  insertContactActivity,
  loadSummaryMaterial,
  updateContactRow,
} from "@/features/crm/server/contact-repository";
import type { ActorContext } from "@/features/crm/server/contact-service";
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from "@/features/crm/summary-prompt";
import type { Contact } from "@/features/crm/types";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import { getAiGateway } from "@/server/ai";
import { withWorkspace } from "@/server/db/client";
import { recordUsageBatch, type UsageKind } from "@/server/usage/record-usage";
import type { ChatMessage } from "@/types/ai";

/** Hard cap on what is persisted, independent of what the model returns. */
const MAX_SUMMARY_CHARS = 4_000;

export interface GenerateSummaryOptions {
  signal?: AbortSignal;
}

/**
 * Summarizes a contact's notes and recent conversation messages into
 * `contacts.ai_summary`. Streaming is collected server-side rather than
 * forwarded: the result is a stored field, and a half-written summary is worse
 * than none, so the row is only written once the stream finishes cleanly.
 */
export async function generateContactSummary(
  ctx: ActorContext,
  contactId: string,
  options: GenerateSummaryOptions = {},
): Promise<Contact> {
  const contact = await findContactById(ctx.workspaceId, contactId);
  if (!contact) throw ApiError.notFound("Contact not found");

  const material = await loadSummaryMaterial(ctx.workspaceId, contactId, {
    notes: SUMMARY_MAX_NOTES,
    messages: SUMMARY_MAX_MESSAGES,
  });

  if (material.notes.length === 0 && material.messages.length === 0) {
    throw ApiError.badRequest("Add a note or link a conversation before generating a summary");
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    { role: "user", content: buildSummaryPrompt(contact, material) },
  ];

  const gateway = getAiGateway();
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of gateway.streamChat({
    messages,
    temperature: 0.2,
    maxTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    metadata: { feature: "crm_summary", workspaceId: ctx.workspaceId },
    signal: options.signal,
  })) {
    if (event.type === "text-delta") text += event.delta;
    else if (event.type === "usage") {
      inputTokens = event.usage.inputTokens;
      outputTokens = event.usage.outputTokens;
    } else if (event.type === "error") {
      throw ApiError.unavailable(event.message);
    } else if (event.type === "done" && event.finishReason === "error") {
      throw ApiError.unavailable("The AI gateway could not finish the summary");
    }
  }

  const summary = text.trim().slice(0, MAX_SUMMARY_CHARS);
  if (!summary) throw ApiError.unavailable("The AI gateway returned an empty summary");

  return withWorkspace(ctx.workspaceId, async (client) => {
    await updateContactRow(ctx.workspaceId, contactId, { aiSummary: summary }, client);
    await insertContactActivity(
      {
        workspaceId: ctx.workspaceId,
        contactId,
        type: "summary_generated",
        description: "AI summary generated",
        metadata: {
          actorId: ctx.userId,
          actorName: ctx.actorName,
          notes: material.notes.length,
          messages: material.messages.length,
        },
      },
      client,
    );
    const usage: Array<{ kind: UsageKind; quantity: number; refType: string; refId: string }> = [
      { kind: "tokens_in", quantity: inputTokens, refType: "contact", refId: contactId },
      { kind: "tokens_out", quantity: outputTokens, refType: "contact", refId: contactId },
    ];
    await recordUsageBatch(
      ctx.workspaceId,
      usage.filter((event) => event.quantity > 0),
      client,
    );
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "contact",
        entityId: contactId,
        action: "summary_generated",
        summary: `Generated an AI summary for “${contactDisplayName(contact)}”`,
        metadata: { notes: material.notes.length, messages: material.messages.length },
      },
      client,
    );

    const updated = await findContactById(ctx.workspaceId, contactId, client);
    if (!updated) throw ApiError.notFound("Contact not found");
    return updated;
  });
}
