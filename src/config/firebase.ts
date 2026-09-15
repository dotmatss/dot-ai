/**
 * Firebase CLIENT configuration.
 *
 * Note what this module is not: it has no `import "server-only"`, because it is
 * meant to reach the browser. These are the first `NEXT_PUBLIC_*` values in the
 * application, and `docs/environment.md` has always said they may only carry
 * things that are safe to publish. These are.
 *
 * ── Why publishing these is safe, and what would not be ─────────────────────
 *
 * A Firebase web API key is an identifier, not a credential. It names the
 * project a client is talking to; it grants nothing on its own, and Google
 * publishes it in every documented web snippet. What protects the project is
 * the Firebase Console configuration behind it - authorized domains, the
 * enabled sign-in providers, per-provider quotas - none of which this value
 * can change.
 *
 * The things that WOULD be dangerous here are the service-account private key
 * and any Admin credential. They appear nowhere in `src/`, are never read by
 * the application at all, and the request path is built so that it cannot want
 * one: ID tokens are verified against Google's published public keys
 * (`src/server/auth/firebase/verify-id-token.ts`). The only consumer of an
 * Admin credential is `scripts/migrate-users-to-firebase.mjs`, which runs on a
 * developer's machine and reads it from the environment.
 *
 * ── Why the server does not read these ──────────────────────────────────────
 *
 * `FIREBASE_PROJECT_ID` is declared separately in `src/config/env.ts` and that
 * is the value token verification checks `aud` and `iss` against. Deriving the
 * expected audience from a `NEXT_PUBLIC_` value would mean the backend trusting
 * a build-time input that the frontend also carries - the precise inversion
 * that makes a verifier meaningless. They should name the same project; only
 * one of them decides anything.
 */

/**
 * Referenced as complete literals on purpose: Next.js inlines
 * `process.env.NEXT_PUBLIC_*` into the browser bundle by textual substitution,
 * so an indexed or computed lookup would silently produce `undefined` in the
 * client build while working in dev.
 */
const rawConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
} as const;

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/**
 * The client configuration, or null when this deployment has no Firebase
 * project.
 *
 * Null is a supported state, not an error: it is how a developer runs the
 * application against local PostgreSQL with the built-in password
 * authentication, and how the test suite runs at all. Every caller branches on
 * it rather than assuming Firebase is present - see `AuthProviderNotice` and
 * the sign-in page.
 *
 * All four values must be present together. A half-filled configuration is a
 * misconfiguration, and treating it as "Firebase is on" would produce an auth
 * form that fails at the first call with a Firebase internal error instead of
 * a legible one.
 */
export function getFirebaseClientConfig(): FirebaseClientConfig | null {
  const { apiKey, authDomain, projectId, appId } = rawConfig;
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return { apiKey, authDomain, projectId, appId };
}

export function isFirebaseAuthEnabled(): boolean {
  return getFirebaseClientConfig() !== null;
}
