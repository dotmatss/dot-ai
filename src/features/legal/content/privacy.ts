import type { LegalDocument } from "@/features/legal/types";

/**
 * Privacy policy.
 *
 * Every factual statement here was checked against the code: the tables in
 * `src/server/db/migrations/`, the cookies in `src/server/auth/session.ts` and
 * `src/stores/ui-preferences-store.tsx`, and the AI boundary in
 * `src/server/ai/`. Nothing describes a practice the application does not have.
 *
 * Where a fact depends on a decision nobody has made yet - the model provider,
 * the hosting region, retention periods - it is a `[[PLACEHOLDER]]`, not a
 * guess. See `src/features/legal/placeholders.ts`.
 */
export const PRIVACY_POLICY: LegalDocument = {
  slug: "privacy",
  title: "Privacy Policy",
  description: "What personal data this service handles, why, and what happens to it.",
  effectiveDate: "[[EFFECTIVE_DATE]]",
  lastUpdated: "11 September 2026",
  reviewAreas: ["jurisdiction", "privacy", "ai", "billing"],
  blocks: [
    {
      type: "callout",
      tone: "warning",
      title: "Draft, pending legal review",
      body: "This policy describes what the software actually does, which is the right starting point. It is not legal advice and it has not been reviewed by a qualified lawyer or privacy professional. The open questions are listed at the end of this page, and values that must be supplied by the operator are marked in place.",
    },

    { type: "heading", id: "who-we-are", text: "Who we are" },
    {
      type: "paragraph",
      text: "The service is operated by [[COMPANY_LEGAL_NAME]], registered at [[COMPANY_REGISTERED_ADDRESS]], company number [[COMPANY_REGISTRATION_NUMBER]]. For questions about this policy, or to make a request about your data, contact [[PRIVACY_CONTACT_EMAIL]]. A data protection officer or privacy representative, where one is appointed, can be reached at [[DPO_CONTACT]].",
    },

    { type: "heading", id: "our-role", text: "Our role" },
    {
      type: "paragraph",
      text: "The service holds two different kinds of information, and our responsibilities differ between them.",
    },
    {
      type: "list",
      items: [
        "**Account data.** Information about the people who sign in and run a workspace. We decide what to collect and why.",
        "**Customer content.** Anything a customer puts into their workspace: chatbot instructions, uploaded or ingested knowledge, conversations with their visitors, and CRM records. We hold this on the customer's behalf and act on their instructions.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Requires confirmation",
      body: "Whether this makes us a controller, a processor, or both under a given law, and whether a data processing agreement is required, has not been determined. The software enforces the separation technically: every customer record carries a workspace identifier, and tenant isolation is enforced both in the queries and by database row-level security.",
    },

    { type: "heading", id: "what-we-collect", text: "What we collect" },
    {
      type: "paragraph",
      text: "This list is generated from the actual database schema. We do not collect anything that is not listed here.",
    },
    {
      type: "table",
      head: ["Category", "What it contains", "Where it comes from"],
      rows: [
        ["Account", "Email address, display name, a hash of your password, and an avatar URL if you set one", "You, when you sign up or edit your profile"],
        ["Sessions", "An opaque token stored only as a hash, the IP address the session started from, your browser's user agent string, and timestamps", "Created automatically when you sign in"],
        ["Workspace", "Organisation and workspace names, slugs, and each member's role", "You, when you create a workspace or change a member's role"],
        ["Chatbots and agents", "Names, instructions, model settings, appearance, and the list of domains allowed to embed a chatbot", "You, when you configure them"],
        ["Knowledge", "Content you upload, paste or ingest from a URL, the chunks it is split into, and the numeric embeddings derived from those chunks", "You, when you add a knowledge source"],
        ["Conversations", "Every message in a conversation, the knowledge citations behind an answer, any tool calls, token counts, the channel used, and for widget conversations the origin of the website the visitor came from", "Generated when someone chats with one of your chatbots or agents"],
        ["CRM", "Contact name, email, phone, company, stage, source, tags, any custom properties you add, notes written by your team, an activity timeline, and AI-written summaries", "You, or your team, or a chatbot conversation linked to a contact"],
        ["Integrations", "Non-secret configuration for a connected service, plus credentials encrypted at rest", "You, when you connect an integration"],
        ["API keys", "A name, a short display prefix, a hash of the key, and when it was last used", "Created when you issue a key"],
        ["Usage", "Counters such as messages generated and tokens consumed, and an activity log of who changed what in a workspace", "Recorded automatically as you use the service"],
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Two details worth stating plainly",
      body: "Widget conversations record the origin of the website the visitor was on, because that is how the allowed-domain rule is enforced. And our rate limiter holds client IP addresses in memory for a short window to stop abuse; those are not written to the database.",
    },

    { type: "heading", id: "what-we-do-not-collect", text: "What we do not collect" },
    {
      type: "list",
      items: [
        "No analytics, product telemetry or session replay. There is no third-party script on any page.",
        "No advertising or marketing identifiers, no tracking pixels, no cross-site tracking, no fingerprinting.",
        "No payment information. Billing is not implemented; nothing is charged and no card details are handled.",
        "No precise location data. IP addresses are recorded for sessions and used transiently for rate limiting, and are not resolved to a location by us.",
        "Web fonts are served from our own domain, so simply loading a page sends nothing to a font provider.",
      ],
    },

    { type: "heading", id: "why-we-use-it", text: "Why we use it" },
    {
      type: "list",
      items: [
        "To run the service: authenticate you, keep you signed in, and show you your workspace.",
        "To provide the features you use: answer questions with a chatbot, retrieve from your knowledge collections, run workflows, and keep your CRM records.",
        "To keep the service secure and available: rate limiting, abuse prevention, and an activity log of changes within a workspace.",
        "To meter usage, so consumption can be measured and, in future, billed.",
        "To support you when you ask us to look at something.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Requires confirmation",
      body: "The lawful basis for each purpose has not been determined and is not recorded anywhere in the application.",
    },

    { type: "heading", id: "ai-processing", text: "AI processing" },
    {
      type: "paragraph",
      text: "This is an AI platform, so it is worth being specific about what happens to the text you and your visitors write.",
    },
    {
      type: "list",
      items: [
        "When a chatbot answers, the visitor's message, the relevant chunks retrieved from your knowledge collecse, and the chatbot's instructions are sent to a model provider through an AI gateway.",
        "The reply, its citations and the token counts are stored in your workspace as part of the conversation.",
        "Embeddings are numeric representations of your knowledge chunks. They are currently produced by a local deterministic provider that makes no external call.",
        "We do not use your content to train any model, and the application has no mechanism to do so.",
        "The public demo on our marketing site is separate from all of this. It has no workspace, answers only from our published documentation, and stores nothing.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Requires confirmation before this page is published",
      body: "The model provider is [[AI_PROVIDER]], reached through Cloudflare AI Gateway. What that provider does with a prompt is a matter of its contract, not of our code: its retention period is [[AI_PROVIDER_RETENTION]] and its training terms are [[AI_PROVIDER_TRAINING_TERMS]]. Until those are confirmed in writing, this section must not claim that prompts are discarded or excluded from training.",
    },

    { type: "heading", id: "cookies", text: "Cookies and similar technologies" },
    {
      type: "paragraph",
      text: "We use two first-party cookies and one local storage key, and no third-party cookies at all. Each one is listed, with its purpose and lifetime, in the [Cookie Policy](/cookies).",
    },

    { type: "heading", id: "sharing", text: "Who else sees it" },
    {
      type: "paragraph",
      text: "We do not sell personal data and we do not share it for advertising. Data reaches a third party only where a service is needed to operate the platform, or where you connect one yourself.",
    },
    {
      type: "table",
      head: ["Recipient", "Why", "What reaches them"],
      rows: [
        ["[[HOSTING_PROVIDER]]", "Runs the application and the database", "Everything stored by the service, at rest and in transit"],
        ["Cloudflare AI Gateway and [[AI_PROVIDER]]", "Generates chatbot and agent replies", "The prompt for a single turn: the message, retrieved knowledge, and the chatbot's instructions"],
        ["Integrations you connect", "Only what you configure, such as posting to an outgoing webhook", "Whatever that integration is configured to send"],
      ],
    },
    {
      type: "paragraph",
      text: "A current list of subprocessors is published at [[SUBPROCESSOR_LIST_LOCATION]].",
    },

    { type: "heading", id: "transfers", text: "International transfers" },
    {
      type: "paragraph",
      text: "The service is hosted by [[HOSTING_PROVIDER]] in [[HOSTING_REGION]]. Where personal data leaves that region, the safeguard relied upon is [[TRANSFER_MECHANISM]].",
    },
    {
      type: "callout",
      tone: "info",
      title: "Requires confirmation",
      body: "Hosting is configured per deployment and is not fixed in the code, so the region and any transfer safeguard must be confirmed for the deployment this policy describes.",
    },

    { type: "heading", id: "retention", text: "How long we keep it" },
    {
      type: "table",
      head: ["Data", "Kept for"],
      rows: [
        ["Account records", "[[RETENTION_ACCOUNT]] after the account is closed"],
        ["Conversations and messages", "[[RETENTION_CONVERSATIONS]]"],
        ["Session records and the activity log", "[[RETENTION_LOGS]]"],
        ["Sessions", "Up to 90 days, then removed automatically"],
        ["Knowledge, CRM records and integrations", "Until you delete them, or until the workspace is deleted"],
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Gap between policy and implementation",
      body: "Apart from sessions, nothing currently expires on a schedule. There is no automatic deletion job. Deleting a record removes its children through database cascades, and deleting a workspace removes everything in it. Retention periods must be agreed before this page is published, and enforcing them will need engineering work.",
    },

    { type: "heading", id: "your-rights", text: "Your rights" },
    {
      type: "paragraph",
      text: "Depending on where you live, you may have the right to access a copy of your data, correct it, delete it, object to or restrict certain processing, and receive it in a portable form. You can also complain to a supervisory authority, which where applicable is [[SUPERVISORY_AUTHORITY]].",
    },
    {
      type: "paragraph",
      text: "To make a request, contact [[PRIVACY_CONTACT_EMAIL]]. If your data is in a customer's workspace rather than in an account you own, we will pass the request to that customer, because it is their record.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Handled manually today",
      body: "There is no self-service data export and no self-service account deletion in the application. Within a workspace you can already edit and delete individual records, change roles, remove members, and end your own sessions. Anything beyond that is a manual request today.",
    },

    { type: "heading", id: "security", text: "How it is protected" },
    {
      type: "list",
      items: [
        "Passwords are stored as salted hashes, never in readable form.",
        "Session cookies are HttpOnly and marked Secure in production, so page scripts cannot read them.",
        "Every workspace record carries a workspace identifier, queries always filter on it, and the database enforces the same boundary independently with row-level security.",
        "API keys are stored only as hashes with a short display prefix, and are shown once at creation.",
        "Integration credentials are encrypted at rest and are never returned to the browser.",
        "Requests that a user's own configuration triggers, such as fetching a URL for a knowledge source, refuse private and loopback addresses and re-check every redirect.",
      ],
    },
    {
      type: "paragraph",
      text: "No system is perfectly secure, and we do not claim otherwise. Known limitations are documented for the engineering team and reviewed as the product grows.",
    },

    { type: "heading", id: "children", text: "Children" },
    {
      type: "paragraph",
      text: "The service is intended for business use and is not directed at children. We do not knowingly collect data from children. If you believe a child has provided us with personal data, contact [[PRIVACY_CONTACT_EMAIL]].",
    },

    { type: "heading", id: "changes", text: "Changes to this policy" },
    {
      type: "paragraph",
      text: "When this policy changes we will update the date at the top of the page. If a change materially affects how we handle personal data, we will make a reasonable effort to tell account holders directly.",
    },
  ],
};
