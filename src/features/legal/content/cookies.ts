import type { DocBlock } from "@/features/docs/types";
import { BROWSER_STORAGE, CATEGORY_LABELS, KIND_LABELS, requiresConsentMechanism } from "@/features/legal/cookies";
import type { LegalDocument } from "@/features/legal/types";

/**
 * Cookie policy.
 *
 * The inventory table is built from `BROWSER_STORAGE`, not retyped, so the
 * page cannot describe a cookie the application no longer sets or miss one it
 * has started setting. Add an entry there and it appears here.
 */
const inventoryTable: DocBlock = {
  type: "table",
  head: ["Name", "Type", "Category", "Purpose", "Expires"],
  rows: BROWSER_STORAGE.map((entry) => [
    entry.name,
    KIND_LABELS[entry.kind],
    CATEGORY_LABELS[entry.category],
    entry.purpose,
    entry.duration,
  ]),
};

/**
 * The consent position is derived, not asserted.
 *
 * If anyone adds an analytics or marketing entry to the inventory, or a
 * third-party one, this paragraph changes by itself - which is the only
 * honest way to keep a statement like this true over time.
 */
const consentBlock: DocBlock = requiresConsentMechanism()
  ? {
      type: "callout",
      tone: "danger",
      title: "Consent is required and is not yet implemented",
      body: "The inventory above now includes storage that is not strictly necessary or not first party. A consent mechanism is required before it is used, and this page must be updated to describe how consent is obtained and withdrawn. This notice appeared automatically because the inventory changed.",
    }
  : {
      type: "callout",
      tone: "info",
      title: "Why there is no cookie banner",
      body: "Every item above is first party. The session cookie is strictly necessary to sign you in, which is normally exempt from consent. The sidebar and appearance preferences exist only because you chose a setting, are not used to build a profile, and are not shared with anyone. On that basis a consent banner does not appear to be required today. This is an engineering assessment of the implementation, not legal advice, and it is one of the questions listed for review below.",
    };

export const COOKIE_POLICY: LegalDocument = {
  slug: "cookies",
  title: "Cookie Policy",
  description: "Every cookie and similar technology this service uses, and why.",
  effectiveDate: "[[EFFECTIVE_DATE]]",
  lastUpdated: "11 September 2026",
  reviewAreas: ["cookies", "billing"],
  blocks: [
    {
      type: "callout",
      tone: "warning",
      title: "Draft, pending legal review",
      body: "This page is generated from the application's actual browser storage. It is accurate about what the software does. It has not been reviewed by a qualified privacy professional.",
    },

    { type: "heading", id: "what-we-use", text: "What we use" },
    {
      type: "paragraph",
      text: "A cookie is a small file a site stores in your browser. Local storage does a similar job with no expiry date. We use both, sparingly, and only for things the site needs in order to work the way you left it.",
    },
    inventoryTable,

    { type: "heading", id: "no-third-parties", text: "What we do not use" },
    {
      type: "list",
      items: [
        "**No third-party cookies.** Nothing on this site sets a cookie for another company.",
        "**No analytics or product telemetry.** There is no measurement script on any page.",
        "**No advertising or tracking pixels**, and no cross-site tracking.",
        "**No fingerprinting.** We do not derive an identifier from your device or browser configuration.",
        "**No fonts loaded from a third party.** Web fonts are served from our own domain, so opening a page does not contact a font provider.",
        "**Nothing stored by the embeddable chat widget.** A widget on someone else's website stores nothing in your browser.",
      ],
    },

    { type: "heading", id: "consent", text: "Consent" },
    consentBlock,

    { type: "heading", id: "your-choices", text: "Your choices" },
    {
      type: "list",
      items: [
        "You can clear or block cookies in your browser settings. Blocking the session cookie will sign you out and prevent you from signing back in, because it is how the service recognises you.",
        "The appearance preference can be changed at any time from the theme control in the site footer. Clearing your browser storage resets it to follow your operating system.",
        "The sidebar preference only exists once you are signed in, and clearing it simply restores the default layout.",
      ],
    },

    { type: "heading", id: "more", text: "More information" },
    {
      type: "paragraph",
      text: "How we handle personal data more generally is described in the [Privacy Policy](/privacy). Questions about this page can be sent to [[PRIVACY_CONTACT_EMAIL]].",
    },
  ],
};
