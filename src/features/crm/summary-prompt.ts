import {
  CONTACT_STAGE_META,
  SUMMARY_MAX_ITEM_CHARS,
  SUMMARY_MAX_TRANSCRIPT_CHARS,
} from "@/features/crm/constants";
import { contactDisplayName } from "@/features/crm/normalize";
import type { ContactStage } from "@/features/crm/types";

export interface SummaryNote {
  body: string;
  authorName: string | null;
}

export interface SummaryMessage {
  role: string;
  content: string;
}

export interface SummaryMaterial {
  notes: SummaryNote[];
  messages: SummaryMessage[];
}

export interface SummaryContact {
  name: string | null;
  email: string | null;
  company: string | null;
  source: string | null;
  stage: ContactStage;
}

export const SUMMARY_SYSTEM_PROMPT = `You write short CRM briefings for a sales or support team.

Rules:
- Use only the notes and conversation excerpts provided. Never invent facts, names, dates or numbers.
- Write 3 to 5 short sentences of plain prose. No headings, no markdown, no bullet points.
- Lead with who the contact is and what they want, then their situation, then the open question or next step.
- If the material is thin, say so plainly instead of padding.`;

function clip(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Renders the contact's material as a prompt.
 *
 * Both lists arrive newest-first and are consumed in that order, so when the
 * character budget runs out it is the oldest material that is dropped. Notes
 * are taken before messages because a note is something a colleague chose to
 * write down, which is denser signal than a chat turn.
 */
export function buildSummaryPrompt(contact: SummaryContact, material: SummaryMaterial): string {
  const header = [
    `Contact: ${contactDisplayName(contact)}`,
    contact.email ? `Email: ${contact.email}` : null,
    contact.company ? `Company: ${contact.company}` : null,
    `Stage: ${CONTACT_STAGE_META[contact.stage].label}`,
    contact.source ? `Source: ${contact.source}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const lines: string[] = [];
  let budget = SUMMARY_MAX_TRANSCRIPT_CHARS;

  for (const note of material.notes) {
    const line = `[note${note.authorName ? ` by ${note.authorName}` : ""}] ${clip(note.body, SUMMARY_MAX_ITEM_CHARS)}`;
    if (line.length > budget) break;
    budget -= line.length;
    lines.push(line);
  }
  for (const message of material.messages) {
    const line = `[${message.role === "user" ? "contact" : "assistant"}] ${clip(message.content, SUMMARY_MAX_ITEM_CHARS)}`;
    if (line.length > budget) break;
    budget -= line.length;
    lines.push(line);
  }

  return `${header}\n\nMaterial (most recent first):\n${lines.join("\n")}`;
}
