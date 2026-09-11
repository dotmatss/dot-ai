"use server";

import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signInSchema, signUpSchema, type SignInInput, type SignUpInput } from "@/features/auth/schemas";
import { authenticateWithPassword, findDefaultWorkspaceSlug, registerUser } from "@/features/auth/server/auth-service";
import { isApiError } from "@/lib/api/api-error";
import { getAuthContext } from "@/server/auth/dal";
import { clearSessionCookie, createSession, destroySession, setSessionCookie } from "@/server/auth/session";
import { DatabaseUnavailableError } from "@/server/db/client";
import { checkRateLimit, checkRateLimits, clientIpFrom } from "@/server/http/rate-limit";
import { actionFailure, type ActionResult } from "@/types/action-result";

function safeNextPath(next: string | undefined): string | null {
  if (!next) return null;
  // Only allow same-origin relative paths to prevent open redirects.
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return next;
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
    destination = safeNextPath(parsed.data.next) ?? (slug ? `/w/${slug}/dashboard` : "/onboarding");
  } catch (error) {
    return toActionFailure(error);
  }
  redirect(destination as Route);
}

export async function signUpAction(input: SignUpInput): Promise<ActionResult> {
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

export async function signOutAction(): Promise<void> {
  const ctx = await getAuthContext();
  if (ctx) {
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
