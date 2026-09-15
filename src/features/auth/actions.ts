"use server";

import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  firebaseIdTokenSchema,
  firebaseInvitedSignUpSchema,
  firebaseSignInSchema,
  firebaseSignUpSchema,
  invitationTokenSchema,
  invitedSignUpSchema,
  signInSchema,
  signUpSchema,
  type FirebaseInvitedSignUpInput,
  type FirebaseSignInInput,
  type FirebaseSignUpInput,
  type InvitedSignUpInput,
  type SignInInput,
  type SignUpInput,
} from "@/features/auth/schemas";
import {
  authenticateWithPassword,
  findDefaultWorkspaceSlug,
  registerInvitedUser,
  registerUser,
} from "@/features/auth/server/auth-service";
import {
  registerInvitedWithFirebase,
  registerWithFirebase,
  signInWithFirebase,
  syncVerificationFromToken,
} from "@/features/auth/server/firebase-auth-service";
import { acceptInvitation } from "@/features/settings/server/invitation-service";
import { isApiError } from "@/lib/api/api-error";
import { getAuthContext } from "@/server/auth/dal";
import { getPlatformGrant } from "@/server/auth/platform-dal";
import { isFirebaseConfigured } from "@/server/auth/firebase/verify-id-token";
import { clearSessionCookie, createSession, destroySession, setSessionCookie } from "@/server/auth/session";
import { DatabaseUnavailableError } from "@/server/db/client";
import { checkRateLimit, checkRateLimits, clientIpFrom } from "@/server/http/rate-limit";
import { actionFailure, actionSuccess, type ActionResult } from "@/types/action-result";

function safeNextPath(next: string | undefined): string | null {
  if (!next) return null;
  // Only allow same-origin relative paths to prevent open redirects.
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return next;
}

/**
 * Where a signed-in account belongs when it asked for nowhere in particular.
 *
 * A dedicated platform operator joins no organization, so `findDefaultWorkspaceSlug`
 * returns null for it and the workspace-less fallback is `/onboarding` - a page
 * that would tell an operator they are not an admin of any organization and
 * offer them nothing. Sending them to their actual home instead is the whole
 * difference between a usable operator account and a dead end.
 *
 * Order matters: a workspace still wins. An operator who also belongs to a
 * tenant is signing in as a customer here, and would not expect the control
 * plane. `/admin` is only the answer when there is no workspace to go to.
 *
 * This discloses nothing: the grant lookup runs for the account that just
 * authenticated, and an account without one is unaffected.
 */
async function landingFor(user: { id: string; emailVerified: boolean }, slug: string | null): Promise<string> {
  // The gate, applied at the point of entry rather than only on arrival.
  //
  // `requireWorkspaceAccess` would bounce an unverified account off the
  // dashboard anyway, so this is not what makes the rule hold - it is what
  // stops the rule being experienced as a flicker through a page the person
  // was never allowed to see. It also covers the workspace-less destinations,
  // which the workspace guard by definition never runs for.
  if (!user.emailVerified) return "/verify-email";
  if (slug) return `/w/${slug}/dashboard`;
  return (await getPlatformGrant(user.id)) ? "/admin" : "/onboarding";
}

/**
 * Where to send someone who has just authenticated.
 *
 * `next` is honoured only for a verified account. An unverified one carrying
 * `?next=/w/acme/dashboard` must not be handed to the workspace guard just to
 * be turned away - and more importantly, a `next` that pointed at a
 * verification-gated page would otherwise decide the destination before the
 * gate ever got a say.
 */
async function destinationAfterAuth(
  user: { id: string; emailVerified: boolean },
  slug: string | null,
  next: string | undefined,
): Promise<string> {
  if (!user.emailVerified) return "/verify-email";
  return safeNextPath(next) ?? (await landingFor(user, slug));
}

/**
 * Refuses the built-in password paths when Firebase owns authentication.
 *
 * Hiding the password form would not have been enough, and this is the reason
 * the check exists at all: a Server Action is an HTTP endpoint. Once Firebase
 * is the identity provider, `signInAction` still sitting there accepting an
 * address and a scrypt hash comparison is a second, weaker way in - one that
 * knows nothing about Firebase's rate limits, its account disablement, its
 * verification state or any MFA configured on the project. An attacker with a
 * password from an old breach would simply skip the UI and post to the action.
 *
 * So the server refuses, rather than the browser declining to offer. Legacy
 * hashes stay in `users.password_hash` until the import is confirmed complete
 * (see `docs/firebase-auth.md`), but they stop being a credential the moment
 * `FIREBASE_PROJECT_ID` is set.
 */
function passwordAuthUnavailable(): ActionResult | null {
  if (!isFirebaseConfigured()) return null;
  return actionFailure("Password sign-in is no longer available. Use the sign-in form, or reset your password.");
}

function toActionFailure(error: unknown): ActionResult {
  if (error instanceof DatabaseUnavailableError) {
    return actionFailure("The database is unavailable. Check the server configuration and try again.");
  }
  if (isApiError(error)) return actionFailure(error.message, error.details);
  console.error("[auth] action failed", error);
  return actionFailure("Something went wrong. Please try again.");
}

export async function signInAction(input: SignInInput): Promise<ActionResult> {
  const unavailable = passwordAuthUnavailable();
  if (unavailable) return unavailable;

  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure("Check the highlighted fields", z.flattenError(parsed.error).fieldErrors);
  }

  // Two independent limits: the per-account one bounds credential stuffing
  // against a single victim even when the attacker rotates addresses, and the
  // per-address one bounds spraying across many accounts from one caller.
  const ip = clientIpFrom(await headers());
  const limit = checkRateLimits([
    { key: `sign-in:email:${parsed.data.email}`, limit: 10, windowMs: 15 * 60_000 },
    { key: `sign-in:ip:${ip}`, limit: 50, windowMs: 15 * 60_000 },
  ]);
  if (!limit.allowed) {
    return actionFailure(`Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`);
  }

  let destination: string;
  try {
    const user = await authenticateWithPassword(parsed.data.email, parsed.data.password);
    if (!user) return actionFailure("Incorrect email or password");
    const { token, session } = await createSession(user.id);
    await setSessionCookie(token, session.expiresAt);
    const slug = await findDefaultWorkspaceSlug(user.id);
    destination = await destinationAfterAuth(user, slug, parsed.data.next);
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(destination as Route);
}

export async function signUpAction(input: SignUpInput): Promise<ActionResult> {
  const unavailable = passwordAuthUnavailable();
  if (unavailable) return unavailable;

  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure("Check the highlighted fields", z.flattenError(parsed.error).fieldErrors);
  }

  const ip = clientIpFrom(await headers());
  const limit = checkRateLimit(`sign-up:${ip}`, { limit: 5, windowMs: 60 * 60_000 });
  if (!limit.allowed) {
    return actionFailure("Too many sign-up attempts from this network. Try again later.");
  }

  let destination: string;
  try {
    const { user, workspaceSlug } = await registerUser(parsed.data);
    const { token, session } = await createSession(user.id);
    await setSessionCookie(token, session.expiresAt);
    destination = `/w/${workspaceSlug}/dashboard`;
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(destination as Route);
}

/**
 * Accepting an invitation as an account that already exists.
 *
 * The invitation lives in the settings feature; this is the adapter that gives
 * it a session, a rate limit and a redirect, which is what every other action
 * in this file is for. The token is the only input, and it is re-validated
 * against the signed-in address inside `acceptInvitation` - a link forwarded to
 * a different account fails there, not here.
 */
export async function acceptInvitationAction(token: string): Promise<ActionResult> {
  const parsed = invitationTokenSchema.safeParse(token);
  if (!parsed.success) return actionFailure("That invitation link is not valid.");

  const ctx = await getAuthContext();
  if (!ctx) return actionFailure("Sign in to accept this invitation.");

  // The token is unguessable, so this bounds hammering rather than guessing.
  const ip = clientIpFrom(await headers());
  const limit = checkRateLimit(`invite-accept:${ip}`, { limit: 20, windowMs: 15 * 60_000 });
  if (!limit.allowed) return actionFailure("Too many attempts. Try again in a few minutes.");

  let destination: string;
  try {
    const { workspaceSlug } = await acceptInvitation(parsed.data, {
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
    });
    destination = `/w/${workspaceSlug}/dashboard`;
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(destination as Route);
}

/**
 * Creating an account *from* an invitation: no organization is created, and the
 * new account lands in the organization that invited it.
 */
export async function signUpWithInvitationAction(input: InvitedSignUpInput): Promise<ActionResult> {
  const unavailable = passwordAuthUnavailable();
  if (unavailable) return unavailable;

  const parsed = invitedSignUpSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure("Check the highlighted fields", z.flattenError(parsed.error).fieldErrors);
  }

  const ip = clientIpFrom(await headers());
  const limit = checkRateLimit(`sign-up:${ip}`, { limit: 5, windowMs: 60 * 60_000 });
  if (!limit.allowed) {
    return actionFailure("Too many sign-up attempts from this network. Try again later.");
  }

  let destination: string;
  try {
    const { user, workspaceSlug } = await registerInvitedUser(parsed.data);
    const { token, session } = await createSession(user.id);
    await setSessionCookie(token, session.expiresAt);
    destination = `/w/${workspaceSlug}/dashboard`;
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(destination as Route);
}

/**
 * Exchanges a verified Firebase ID token for an application session.
 *
 * ── Why an exchange, and not a Bearer token on every request ────────────────
 *
 * Because of what this application is. Nearly every page is a Server Component
 * rendered during a browser navigation, and a browser navigation cannot carry
 * an `Authorization` header - only cookies. An architecture that put the ID
 * token on every request would therefore have to keep it in a cookie anyway,
 * where it would be a bearer credential this server cannot revoke, valid for
 * its full hour after an account is disabled.
 *
 * So Firebase proves who this is, once, and the application issues its own
 * session (ADR 0001): an opaque token whose SHA-256 is the only thing stored,
 * revocable by deleting one row, and already understood by every page, action
 * and route handler in the codebase. Programmatic clients that genuinely want
 * to present an ID token per request still can - `requireApiAuth` accepts
 * `Authorization: Bearer <id-token>` on the API surface.
 *
 * Note what does NOT appear below: no email, no uid, no role, no verified
 * flag. The token is the only input, and everything else is read from it after
 * verification.
 */
export async function signInWithFirebaseAction(input: FirebaseSignInInput): Promise<ActionResult> {
  const parsed = firebaseSignInSchema.safeParse(input);
  if (!parsed.success) return actionFailure("That sign-in could not be completed. Try again.");

  // Same shape of limit as the password path. Not keyed by email: we do not
  // know the address until the token is verified, and verification is the
  // expensive step this is meant to bound.
  const ip = clientIpFrom(await headers());
  const limit = checkRateLimit(`firebase-sign-in:${ip}`, { limit: 50, windowMs: 15 * 60_000 });
  if (!limit.allowed) {
    return actionFailure(`Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`);
  }

  let destination: string;
  try {
    const { user, emailVerified, workspaceSlug } = await signInWithFirebase(parsed.data.idToken);
    const { token, session } = await createSession(user.id);
    await setSessionCookie(token, session.expiresAt);
    destination = await destinationAfterAuth({ ...user, emailVerified }, workspaceSlug, parsed.data.next);
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(destination as Route);
}

/**
 * Completes a Firebase registration: creates the application user, the
 * organization and the workspace, then signs the browser in.
 *
 * The Firebase account and its verification email already happened in the
 * browser before this was called. Deliberately: it means the password went to
 * Firebase over TLS and never reached this server, which is the point of §3,
 * and it is not something a server-side `createUser` could preserve.
 *
 * `role` is absent from the input by construction, not filtered out of it.
 * `insertOrganization` assigns `owner` to the creator server-side, and there is
 * no code path by which a registration request can influence it - which is
 * what §13 asks for.
 */
export async function signUpWithFirebaseAction(input: FirebaseSignUpInput): Promise<ActionResult> {
  const parsed = firebaseSignUpSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure("Check the highlighted fields", z.flattenError(parsed.error).fieldErrors);
  }

  const ip = clientIpFrom(await headers());
  const limit = checkRateLimit(`sign-up:${ip}`, { limit: 5, windowMs: 60 * 60_000 });
  if (!limit.allowed) {
    return actionFailure("Too many sign-up attempts from this network. Try again later.");
  }

  let destination: string;
  try {
    const { user, workspaceSlug, emailVerified } = await registerWithFirebase(parsed.data);
    const { token, session } = await createSession(user.id);
    await setSessionCookie(token, session.expiresAt);
    // The workspace exists either way - it is theirs, and it is waiting. What
    // is withheld is entry to it until the address is confirmed. A Google
    // registration arrives already verified and goes straight through.
    destination = emailVerified ? `/w/${workspaceSlug}/dashboard` : "/verify-email";
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(destination as Route);
}

/** Registration through an invitation, with Firebase as the identity provider. */
export async function signUpWithInvitationFirebaseAction(input: FirebaseInvitedSignUpInput): Promise<ActionResult> {
  const parsed = firebaseInvitedSignUpSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure("Check the highlighted fields", z.flattenError(parsed.error).fieldErrors);
  }

  const ip = clientIpFrom(await headers());
  const limit = checkRateLimit(`sign-up:${ip}`, { limit: 5, windowMs: 60 * 60_000 });
  if (!limit.allowed) {
    return actionFailure("Too many sign-up attempts from this network. Try again later.");
  }

  let destination: string;
  try {
    const { user, workspaceSlug, emailVerified } = await registerInvitedWithFirebase(parsed.data);
    const { token, session } = await createSession(user.id);
    await setSessionCookie(token, session.expiresAt);
    destination = emailVerified ? `/w/${workspaceSlug}/dashboard` : "/verify-email";
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(destination as Route);
}

/**
 * Re-reads verification state from Firebase and mirrors it into PostgreSQL.
 *
 * Called by the verify-email page after the browser has refreshed its ID
 * token, which is what makes this trustworthy: the refreshed token carries
 * Firebase's current `email_verified` claim, and this server checks the
 * signature on it. The page cannot assert verification, only supply a token
 * that does or does not prove it.
 *
 * Returns rather than redirects, so the page can distinguish "verified now"
 * from "still not verified" and say so, instead of bouncing the user around.
 */
export async function syncEmailVerificationAction(idToken: string): Promise<ActionResult<{ emailVerified: boolean }>> {
  const parsed = firebaseIdTokenSchema.safeParse(idToken);
  if (!parsed.success) return actionFailure("That sign-in could not be verified. Sign in again.");

  const ip = clientIpFrom(await headers());
  const limit = checkRateLimit(`verify-refresh:${ip}`, { limit: 30, windowMs: 10 * 60_000 });
  if (!limit.allowed) return actionFailure("Too many checks. Wait a minute and try again.");

  try {
    const { emailVerified } = await syncVerificationFromToken(parsed.data);
    return actionSuccess({ emailVerified });
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function signOutAction(): Promise<void> {
  const ctx = await getAuthContext();
  // `getAuthContext` is the cookie path, so a context here always carries a
  // session row. The check is for the type, not for a case that happens.
  if (ctx?.session) {
    try {
      await destroySession(ctx.session.sessionId);
    } catch (error) {
      // The cookie is cleared regardless so the browser is signed out, but a
      // surviving session row is a real security gap: surface it rather than
      // reporting a sign-out that only half happened.
      console.error("[auth] failed to revoke session on sign out", error);
      await clearSessionCookie();
      throw new Error("Signed out of this browser, but the session could not be revoked on the server. Please try again.");
    }
  }
  await clearSessionCookie();
  redirect("/sign-in");
}
