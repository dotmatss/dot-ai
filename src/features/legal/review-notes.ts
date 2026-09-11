/**
 * Open questions for a qualified lawyer or privacy professional.
 *
 * These pages are drafted from the application's actual behaviour. That makes
 * them accurate about what the software does. It does not make them legal
 * advice, and it does not make the service compliant with any particular law.
 * The gap between those two things is written down here rather than left
 * implicit, and it is rendered on the pages themselves.
 */

export type ReviewArea = "jurisdiction" | "privacy" | "ai" | "cookies" | "engineering" | "billing";

export interface ReviewNote {
  area: ReviewArea;
  question: string;
  /** What the code actually does today, so the reviewer starts from fact. */
  currentState: string;
}

export const REVIEW_NOTES: ReadonlyArray<ReviewNote> = [
  {
    area: "jurisdiction",
    question:
      "Which laws apply? That depends on where the operating entity is established, where customers contract from, and where end users are located. Candidates commonly in scope for a SaaS of this shape include the EU and UK GDPR, the ePrivacy rules on storing information on a device, US state privacy laws such as the CCPA as amended, and sector rules if customers upload regulated data.",
    currentState:
      "The application does not restrict sign-ups by country and does not record a user's location. No jurisdiction is asserted anywhere in the code.",
  },
  {
    area: "jurisdiction",
    question:
      "Is the operator a controller, a processor, or both? For account data it is likely a controller; for content a customer puts into a chatbot, a knowledge base or the CRM it is likely a processor acting for that customer. That distinction changes what the policy must say and whether a data processing agreement is required.",
    currentState:
      "The data model is multi-tenant: every customer record carries a workspace id, and tenant isolation is enforced in SQL and by Row Level Security. The code makes no controller or processor claim.",
  },
  {
    area: "privacy",
    question: "What lawful basis applies to each processing purpose, and where is it recorded?",
    currentState: "No lawful basis is recorded anywhere in the application, because no consent or preference is captured.",
  },
  {
    area: "privacy",
    question: "What retention periods should apply to accounts, conversations, session records and the activity log?",
    currentState:
      "Nothing expires automatically today, apart from sessions. There is no scheduled deletion job. Deleting a workspace cascades to its data through database foreign keys.",
  },
  {
    area: "privacy",
    question:
      "Does the service need a self-service data export and account deletion flow to satisfy access and erasure requests, or is a manual process acceptable at this stage?",
    currentState:
      "There is no self-service export and no self-service account deletion. A workspace member with sufficient role can delete individual records, and deleting a row cascades to its children.",
  },
  {
    area: "ai",
    question:
      "Which model provider sits behind the AI gateway, what does its contract say about retaining prompts and outputs, and does it exclude submitted content from training?",
    currentState:
      "The AI boundary is provider-agnostic and configured by environment variable. It ships with a mock provider that makes no external call. A production deployment points at Cloudflare AI Gateway in front of a provider that is not chosen in the code.",
  },
  {
    area: "ai",
    question:
      "Is a subprocessor list required, and who belongs on it? At minimum it will include the hosting provider, the database host, the AI gateway and the model provider.",
    currentState: "No subprocessor list exists. No third-party service is contacted unless an operator configures one.",
  },
  {
    area: "ai",
    question:
      "Do customers need contractual assurance that content in their knowledge bases and conversations is not used to improve the service or any model?",
    currentState:
      "The application does not use customer content for training, and has no mechanism to do so. Embeddings are currently produced by a local deterministic provider, not sent to a third party.",
  },
  {
    area: "cookies",
    question:
      "Is a consent banner required? The session cookie is strictly necessary and normally exempt. The sidebar and theme preferences are first party, set by the user's own action, and are not used to profile anyone.",
    currentState:
      "Two first-party cookies and one local storage key, all listed in the cookie inventory. No third-party cookies, no analytics, no advertising, no tracking pixels, no fingerprinting.",
  },
  {
    area: "cookies",
    question:
      "If analytics or product telemetry is added later, consent handling and this page both have to change before it ships. Who owns that gate?",
    currentState: "The inventory is derived from code and a test fails when the two disagree, but nothing blocks a deployment.",
  },
  {
    area: "engineering",
    question: "Where are the application and database hosted, and does any personal data leave that region?",
    currentState: "Hosting is not fixed in the code. The database connection is an environment variable.",
  },
  {
    area: "billing",
    question:
      "Who is the seller of record once payments are introduced, and who is responsible for collecting and remitting sales tax or VAT? A merchant-of-record provider changes the answer, and with it what the terms must say about price, tax and invoicing.",
    currentState:
      "Billing is not implemented. No payment provider is integrated, no payment detail is collected, and no charge is made. The terms say so plainly and the pricing page marks every price as undecided.",
  },
  {
    area: "billing",
    question:
      "What are the refund, cancellation and downgrade terms, including whether a cancellation takes effect immediately or at the end of a paid period, and what happens to data held above a lower plan's limits?",
    currentState:
      "Nothing enforces a limit today, so a downgrade has no effect on stored data. The terms state that billing terms will be published before they take effect and will not apply retroactively.",
  },
  {
    area: "billing",
    question:
      "Once a payment provider is integrated it becomes a processor or an independent controller for billing data, and must be named in the privacy policy and on the subprocessor list. Which is it, and what customer information reaches it?",
    currentState:
      "The privacy policy currently states that no payment information is collected, which is accurate. That sentence has to change in the same commit that introduces checkout, or it becomes false.",
  },
  {
    area: "billing",
    question:
      "Does the payment provider set cookies or similar storage on the checkout page or in any embedded component? If checkout is hosted on the provider's own domain, our cookie policy may be unaffected; if anything is embedded, the inventory and the consent position both change.",
    currentState:
      "The cookie inventory contains three first-party entries and no third-party storage. `requiresConsentMechanism()` returns false today and flips automatically if a third-party entry is added.",
  },
  {
    area: "billing",
    question:
      "For a multi-tenant product, is the contracting party the individual who signs up or the organisation they belong to? That decision affects who can authorise a subscription, who receives the invoice, and who can cancel.",
    currentState:
      "Membership and roles are held at the organisation level; workspaces belong to an organisation. Nothing in the code establishes a billing owner, because nothing bills.",
  },
  {
    area: "engineering",
    question:
      "Should the activity log be made tamper-evident, and should access to customer content by operator staff be logged separately?",
    currentState:
      "An activity log records who changed what within a workspace. It is an ordinary table with no immutability guarantee, and there is no separate record of operator access.",
  },
];

export function notesFor(area: ReviewArea): ReviewNote[] {
  return REVIEW_NOTES.filter((note) => note.area === area);
}

export const REVIEW_AREA_LABELS: Record<ReviewArea, string> = {
  jurisdiction: "Jurisdiction and roles",
  billing: "Billing and tax",
  privacy: "Privacy",
  ai: "AI processing",
  cookies: "Cookies",
  engineering: "Engineering",
};
