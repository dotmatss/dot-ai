# ADR 0007 — Firebase Authentication as the identity provider

**Status:** Accepted · **Date:** 2026-09-15 · **Supersedes nothing; realizes ADR 0001**

## Context

ADR 0001 built the application around an identity-provider *seam*: app-owned
sessions, `user_identities` for external providers, and
`findOrCreateUserForIdentity()` as the entry point, with Firebase named as the
intended provider once a project existed. This ADR records the three decisions
taken when actually wiring it up, each of which had a plausible alternative.

Two constraints shaped all three. The deployment target is **Cloudflare
Workers** (`docs/deployment.md`), and the application is **server-rendered** —
nearly every page is a Server Component reached by browser navigation, not an
SPA calling an API.

## Decisions

### 1. The link lives in `user_identities`, not a `users.firebase_uid` column

`user_identities` already exists with `UNIQUE (provider, provider_uid)`, which
is the guarantee a `firebase_uid` column would have been added to provide.
Adding the column would create a second home for one fact, able to disagree with
the first, and would need widening or a join partner the moment a second
provider is enabled — a user may hold several external identities but only one
`firebase_uid`.

**Rejected:** `users.firebase_uid UNIQUE`. Simpler to read in a query, but it
duplicates an existing constraint and prices in a migration for the next
provider.

### 2. The ID token is exchanged for an application session, not carried per request

Firebase authenticates; the server verifies the ID token once and issues its own
session cookie.

A browser navigation cannot carry an `Authorization` header, so "Bearer on every
request" would in practice mean keeping the ID token in a cookie — an
unrevocable bearer credential valid for up to an hour after an account is
disabled. The application session is a row delete.

The API surface additionally **accepts** `Authorization: Bearer <id-token>`
(`requireApiAuth`), so programmatic clients that prefer per-request tokens are
served without the web app inheriting the cost.

**Rejected:** Firebase session cookies as the only session — couples every
request to Firebase and blocks local development, as ADR 0001 already found.

### 3. Tokens are verified against Google's JWKS with WebCrypto, not with `firebase-admin`

`firebase-admin` is a Node SDK (`node:http2`, filesystem credentials, long-lived
process) and does not run on workerd. Firebase documents the alternative it
exists for: verify the ID token as an RS256 JWT against Google's published
public keys, applying the documented claim rules. WebCrypto is a platform global
on both Node 22 and workerd, so one implementation serves every environment and
the runtime dependency list does not grow.

`firebase-admin` remains a devDependency used by
`scripts/migrate-users-to-firebase.mjs`, which needs `importUsers` and a
service-account credential. Nothing under `src/` imports it.

**Rejected:** running the Admin SDK on Workers (does not work); a second Node
service purely to verify signatures (a microservice for authentication, which
§26 of the brief and plain sense both rule out).

## Consequences

- Authorization is untouched. `organization_members.role` and `platform_admins`
  decide everything they decided before, for both credential kinds.
- `users.email_verified` (migration 0029) mirrors the Firebase claim, written
  only by the server from a verified token, in both directions.
- An unverified external identity may never adopt an application account that
  already exists — without that rule the email match is an account-takeover
  primitive. Creating a new account from one stays allowed.
- Existing scrypt passwords migrate into Firebase intact via
  `STANDARD_SCRYPT`; accounts without a password need one reset.
- Setting `FIREBASE_PROJECT_ID` disables the password Server Actions, because a
  Server Action is an HTTP endpoint and hiding the form would leave a second,
  weaker way in.
- Firebase stays optional. Unset, the application runs on its own scrypt
  credentials, which is what keeps local development and the test suite
  hermetic.
