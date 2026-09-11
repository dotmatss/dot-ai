import type { BadgeTone } from "@/components/ui/app-badge";
import type { ContactStage } from "@/features/crm/types";

export const CONTACT_STAGE_META: Record<ContactStage, { label: string; tone: BadgeTone; description: string }> = {
  lead: { label: "Lead", tone: "neutral", description: "Captured, not qualified yet." },
  prospect: { label: "Prospect", tone: "info", description: "Actively being qualified or in a deal." },
  customer: { label: "Customer", tone: "success", description: "Paying or actively using the product." },
  churned: { label: "Churned", tone: "danger", description: "Was a customer and has left." },
};

/** Order used for stage chips and the stage picker: the natural lifecycle. */
export const CONTACT_STAGE_ORDER: ReadonlyArray<ContactStage> = ["lead", "prospect", "customer", "churned"];

/**
 * `contact_activities.type` is free text so integrations can add their own,
 * but everything this feature writes comes from here. The timeline falls back
 * to a generic label and icon for unknown types.
 */
export const CONTACT_ACTIVITY_TYPES = [
  "created",
  "updated",
  "stage_changed",
  "tags_changed",
  "properties_changed",
  "summary_generated",
] as const;
export type ContactActivityType = (typeof CONTACT_ACTIVITY_TYPES)[number];

export const CONTACT_ACTIVITY_LABELS: Record<ContactActivityType, string> = {
  created: "Contact created",
  updated: "Details updated",
  stage_changed: "Stage changed",
  tags_changed: "Tags changed",
  properties_changed: "Properties changed",
  summary_generated: "AI summary generated",
};

/** Conversation statuses, mirrored locally so the CRM does not depend on the inbox feature. */
export const CONTACT_CONVERSATION_STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
  escalated: { label: "Escalated", tone: "warning" },
};

export const CONTACT_CONVERSATION_CHANNEL_LABELS: Record<string, string> = {
  widget: "Widget",
  playground: "Playground",
  api: "API",
  agent: "Agent",
};

/* -------------------------------------------------------------------------- */
/* Limits                                                                      */
/* -------------------------------------------------------------------------- */

export const MAX_TAGS_PER_CONTACT = 20;
export const MAX_TAG_LENGTH = 32;

export const MAX_CUSTOM_PROPERTIES = 40;
export const MAX_PROPERTY_KEY_LENGTH = 40;
export const MAX_PROPERTY_VALUE_LENGTH = 500;

/**
 * Property keys are shown as column-like labels and may be referenced by
 * workflows, so they stay to a conservative, predictable character set.
 */
export const PROPERTY_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/;

export const MAX_NOTE_LENGTH = 5_000;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_NAME_LENGTH = 120;
export const MAX_PHONE_LENGTH = 40;
export const MAX_COMPANY_LENGTH = 120;
export const MAX_SOURCE_LENGTH = 80;

/** Tag filter facet size; more tags than this are reachable through search. */
export const TAG_FACET_LIMIT = 50;

/* -------------------------------------------------------------------------- */
/* AI summary                                                                  */
/* -------------------------------------------------------------------------- */

/** Newest notes fed to the summarizer. */
export const SUMMARY_MAX_NOTES = 20;
/** Newest conversation messages fed to the summarizer. */
export const SUMMARY_MAX_MESSAGES = 40;
/** Per-item character cap, so one long note cannot fill the prompt. */
export const SUMMARY_MAX_ITEM_CHARS = 1_200;
/** Overall transcript cap sent to the model. */
export const SUMMARY_MAX_TRANSCRIPT_CHARS = 16_000;
/** Upper bound on the generated summary, matching the prompt's instruction. */
export const SUMMARY_MAX_OUTPUT_TOKENS = 400;
