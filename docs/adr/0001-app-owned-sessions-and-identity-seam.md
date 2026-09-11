# ADR 0001 — Authentication: app-owned sessions with a pluggable identity provider

**Status:** Accepted (initial development phase) · **Date:** 2026-09-10

## Context

Firebase Authentication (including Google sign-in) is the intended identity provider, but no Firebase project or credentials exist yet, and the application must run end-to-end against local PostgreSQL today. Authorization (tenant isolation, roles) must be enforced by our server regardless of who verifies identity.

## Decision

1. **Sessions are owned by the application.** A random 256-bit token is stored in an `HttpOnly`, `SameSite=Lax`, `Secure` (in production) cookie; the database stores only its SHA-256 hash (`sessions` table) with sliding expiry. Revocation is a row delete.
2. **Identity providers are a seam, not the session.** `src/features/auth/server/auth-service.ts` exposes `authenticateWithPassword()` (local credentials, scrypt hashed) and `findOrCreateUserForIdentity()` for external providers, backed by the `user_identities` table. Firebase/Google plugs in by verifying an ID token server-side (firebase-admin) and calling `findOrCreateUserForIdentity({ provider: "firebase", providerUid, email, name })`, then creating the same application session.
3. **Authorization lives in the Data Access Layer** (`src/server/auth/dal.ts`): `requireWorkspaceAccess()` for pages and `requireApiWorkspaceAccess()` for route handlers resolve membership and role on every request. `proxy.ts` only performs an optimistic cookie-presence redirect.

## Alternatives

- **Firebase session cookies as the only session** — couples every request to Firebase and blocks local development without credentials.
- **Auth.js (NextAuth)** — adds a dependency and its own schema; offers little over the small session module while Firebase remains the target provider.

## Consequences

- Local development works with email/password; production adds Firebase without changing authorization code.
- Password hashing uses Node's built-in scrypt (no `bcrypt` dependency).
- Rate limiting on sign-in/sign-up is in-memory (`src/server/http/rate-limit.ts`) and must be backed by Cloudflare WAF / a shared store in production.
