# Legal pages, cookies and privacy

> **This document, and the pages it describes, are not legal advice.** They describe what the software does. Whether that satisfies any particular law is a question for a qualified lawyer or privacy professional, and the open questions are tracked in code at `src/features/legal/review-notes.ts` and rendered on the pages themselves.

## Where the content lives

| Concern | File |
| --- | --- |
| Terms of service | `src/features/legal/content/terms.ts` |
| Privacy policy | `src/features/legal/content/privacy.ts` |
| Cookie policy | `src/features/legal/content/cookies.ts` |
| What the app stores in a browser | `src/features/legal/cookies.ts` |
| Values the operator must supply | `src/features/legal/placeholders.ts` |
| Open questions for review | `src/features/legal/review-notes.ts` |
| Which pages exist | `src/features/legal/registry.ts` |

Policies are **data, not components**. Each document is a list of `DocBlock` values, the same model the documentation site uses, rendered by the same `DocBlocks` renderer. Updating a policy means editing an array of objects. No legal text is hard-coded into a component, a layout or a route.

Routes are thin: `src/app/(marketing)/{terms,privacy,cookies}/page.tsx` resolve a document through the registry and render `LegalPage`. They are Server Components and ship no JavaScript of their own.

## Placeholders instead of invented facts

Anything the codebase cannot know is written as `[[NAME]]` and rendered as a marked, screen-reader-announced gap, not as plausible-looking text. A policy with a convincing fake registered address is more dangerous than one that visibly says the address is missing, because only the second is obviously unfinished.

Every placeholder is declared in `placeholders.ts` with a description and an owner (`company`, `legal` or `engineering`). `tests/unit/legal-content.test.ts` fails if content uses an undeclared placeholder, or declares one it never uses.

The same test refuses content that contains an email address, a company suffix, a street address, a phone number, a named governing law or supervisory authority, a named model or hosting vendor, a compliance claim, an uptime or certification claim, or anything shaped like a credential. If a future edit invents any of those, the build fails.

## What the application stores in a browser

Three entries, all first party. `src/features/legal/cookies.ts` is the single source of truth; the cookie policy table is generated from it.

| Name | Type | Category | Set by |
| --- | --- | --- | --- |
| `dot_session` | Cookie, HttpOnly, SameSite=Lax, Secure in production, up to 90 days | Strictly necessary | `src/server/auth/session.ts` |
| `dot_sidebar_collapsed` | Cookie, script-readable, SameSite=Lax, 1 year | Functional | `src/stores/ui-preferences-store.tsx` |
| `dot-theme` | Local storage | Functional | `src/lib/theme/theme.ts` |

There is no third-party cookie, no analytics, no advertising or marketing identifier, no tracking pixel, no session replay and no fingerprinting. Web fonts are self-hosted by Next.js at build time, so loading a page contacts no font provider. The embeddable widget stores nothing in a visitor's browser.

`tests/unit/legal-cookies.test.ts` checks each inventory entry against the file that claims to write it, asserts the widget stores nothing, and fails if a `dot_*` storage key appears in the code without being listed.

### The consent decision

**No consent banner is implemented, and on the current inventory none appears to be required.** The session cookie is strictly necessary. The sidebar and theme preferences are first party, exist only because the user chose a setting, and are not used to profile anyone.

That position is derived, not asserted. `requiresConsentMechanism()` returns true as soon as any entry is in the analytics or marketing category, or is not first party, and the cookie policy swaps its notice for one saying consent is required and not yet implemented. **Adding any analytics, advertising, A/B testing or session-replay tool changes the answer**, and the page will say so on its own. A test covers both branches.

This is an engineering assessment of the implementation. It is one of the questions listed for legal review.

## Gaps between the policy and the implementation

Stated plainly, because the pages state them plainly:

- **No retention enforcement.** Apart from sessions, nothing expires on a schedule and there is no deletion job. Deletion cascades through database foreign keys when a record or workspace is removed.
- **No self-service data export and no self-service account deletion.** Within a workspace a member can already edit and delete records, change roles, remove members and end their own sessions. Anything wider is manual today.
- **No consent or lawful-basis record**, because no consent is captured.
- **The activity log is an ordinary table.** It is not tamper-evident, and operator access to customer content is not separately recorded.

These are engineering requirements that follow from a legal decision, not decisions engineering should make alone. None were built speculatively.

## AI processing

The AI boundary is provider-agnostic (`src/server/ai/`). It ships with a mock provider that makes no external call; a real deployment points at Cloudflare AI Gateway in front of a model provider that **is not chosen in the code**. Embeddings are currently produced by a local deterministic provider and are not sent anywhere.

The application does not use customer content for training and has no mechanism to do so. What a model provider does with a prompt is a matter of its contract, so the privacy policy marks its retention and training terms as placeholders. **Do not fill those in from a vendor's marketing page.**

The public demo on the marketing site is separate from all of this: it has no workspace, answers only from the published documentation, persists nothing, and its isolation is enforced by a test that walks its import graph.

## Updating a policy

1. Edit the relevant file under `src/features/legal/content/`.
2. Update `lastUpdated`. Leave `effectiveDate` as `[[EFFECTIVE_DATE]]` until the document has actually been reviewed and published.
3. If you added a value the operator must supply, declare it in `placeholders.ts`.
4. If you changed what the application stores in a browser, update `cookies.ts` **in the same commit**.
5. Run the verification script. The content tests are the guard rail.
