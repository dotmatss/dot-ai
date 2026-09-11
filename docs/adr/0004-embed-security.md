# ADR 0004 — Website embedding as a secure integration boundary

**Status:** Accepted · **Date:** 2026-09-10

## Context

Customers embed chatbots on their own sites. The browser cannot hold tenant secrets, and the parent page origin is not visible to API calls made from inside an iframe served by our origin.

## Decision

- The public loader (`public/embed/widget.js`) only creates a launcher and an iframe pointing at `/embed/[embedKey]`. The embed key is a public identifier.
- When the iframe document is requested, the server (`resolveEmbed`) reads the parent origin from the `Referer` header, checks the chatbot is `active` and the origin matches the allowed-domain list (`*.example.com` wildcards supported), and mints a **short-lived HMAC-signed embed token** bound to `{ embedKey, origin }`.
- The public chat endpoint (`POST /api/public/chat`) requires that token, re-checks status and domain, and rate limits per IP and per chatbot. Workspace members opening the widget from the app origin receive a `preview` token so inactive chatbots can be tested.
- Application routes send `frame-ancestors 'none'`; only `/embed/*` allows framing.

## Consequences

- A browser cannot use the chatbot from an unlisted site: the iframe document is refused, so no token is ever minted in that page.
- `APP_SECRET` must be set in production (development uses a fixed fallback and logs nothing sensitive).
- Referrer-Policy on customer pages must allow at least `strict-origin-when-cross-origin` (the browser default) for the iframe request; the loader sets this on the iframe. The in-app preview link must not use `rel="noreferrer"`, which would strip the header the preview path depends on.

## Limitation: the parent origin is self-declared

`Referer` is trustworthy for browsers and not for anything else. A server-side caller that knows a published embed key can send a forged `Referer`, receive a valid token, and drive the chatbot from anywhere. This is an abuse-and-cost problem rather than a data-access one — the token grants exactly one capability, chatting with a chatbot its owner already published — but it means **allowed-domain enforcement is a browser-facing control, not an API-level one**, and the product UI should not promise more than that.

Mitigations in place: ceilings keyed on the workspace and chatbot id (which no caller can rotate), a short token lifetime, an `Origin` check on the chat endpoint, and usage metering per workspace.

Closing it properly requires both of:

1. A per-chatbot `Content-Security-Policy: frame-ancestors <allowed domains>` on the `/embed/[embedKey]` response, so the browser itself refuses the frame. Static `next.config.ts` headers cannot express this, so it needs the response to be produced somewhere that can set headers per request.
2. A nonce the page cannot forge — set as a cookie on the iframe response and required by the chat endpoint — so a harvested token alone is insufficient.
