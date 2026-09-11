/**
 * Values this application cannot know, and must never invent.
 *
 * Each one appears in the policy text as `[[NAME]]` and renders as a marked,
 * screen-reader-announced gap. That is deliberate: a policy containing a
 * plausible-sounding registered address is worse than one that visibly says
 * the address is missing, because only the second is obviously unfinished.
 *
 * `tests/unit/legal-content.test.ts` asserts that every placeholder used in
 * the content is declared here, and that every declared placeholder is used.
 */

export interface LegalPlaceholder {
  /** The token as it appears in content, without the brackets. */
  name: string;
  /** What has to be supplied. */
  describes: string;
  /** Who can answer it. */
  owner: "company" | "legal" | "engineering";
}

export const LEGAL_PLACEHOLDERS: ReadonlyArray<LegalPlaceholder> = [
  { name: "COMPANY_LEGAL_NAME", describes: "The registered legal entity that operates the service", owner: "company" },
  { name: "COMPANY_REGISTERED_ADDRESS", describes: "The registered office address of that entity", owner: "company" },
  { name: "COMPANY_REGISTRATION_NUMBER", describes: "Company or business registration number, where one exists", owner: "company" },
  { name: "CONTACT_EMAIL", describes: "General contact address for enquiries about these terms", owner: "company" },
  { name: "PRIVACY_CONTACT_EMAIL", describes: "Address that receives privacy requests and complaints", owner: "company" },
  { name: "DPO_CONTACT", describes: "Data protection officer or privacy representative, if one is appointed", owner: "legal" },
  { name: "GOVERNING_LAW", describes: "The law governing the agreement", owner: "legal" },
  { name: "COURTS_JURISDICTION", describes: "The courts with jurisdiction over disputes", owner: "legal" },
  { name: "SUPERVISORY_AUTHORITY", describes: "The lead data protection supervisory authority, where one applies", owner: "legal" },
  { name: "HOSTING_PROVIDER", describes: "Who hosts the application and the database, and in which region", owner: "engineering" },
  { name: "HOSTING_REGION", describes: "The region personal data is stored in", owner: "engineering" },
  { name: "AI_PROVIDER", describes: "The model provider reached through the AI gateway", owner: "engineering" },
  { name: "AI_PROVIDER_RETENTION", describes: "How long that provider retains prompts and outputs, per its contract", owner: "legal" },
  { name: "AI_PROVIDER_TRAINING_TERMS", describes: "Whether that provider may train on submitted content, per its contract", owner: "legal" },
  { name: "SUBPROCESSOR_LIST_LOCATION", describes: "Where the current subprocessor list is published", owner: "company" },
  { name: "RETENTION_ACCOUNT", describes: "How long account records are kept after closure", owner: "legal" },
  { name: "RETENTION_CONVERSATIONS", describes: "How long conversations and messages are kept", owner: "legal" },
  { name: "RETENTION_LOGS", describes: "How long session and activity records are kept", owner: "legal" },
  { name: "TRANSFER_MECHANISM", describes: "The safeguard relied on for international transfers, if any", owner: "legal" },
  { name: "EFFECTIVE_DATE", describes: "The date these documents take effect once reviewed and published", owner: "legal" },
];

const PLACEHOLDER_PATTERN = /\[\[([A-Z0-9_]+)\]\]/g;

/** Every placeholder token used in a piece of content. */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]!);
}

export function isDeclaredPlaceholder(name: string): boolean {
  return LEGAL_PLACEHOLDERS.some((placeholder) => placeholder.name === name);
}

export function placeholdersByOwner(owner: LegalPlaceholder["owner"]): LegalPlaceholder[] {
  return LEGAL_PLACEHOLDERS.filter((placeholder) => placeholder.owner === owner);
}
