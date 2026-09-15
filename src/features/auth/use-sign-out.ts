"use client";

import { useTransition } from "react";

import { signOutAction } from "@/features/auth/actions";
import { signOutOfFirebase } from "@/features/auth/firebase-client";

/**
 * Signing out of both sessions, as one action.
 *
 * With Firebase there are two independent sessions behind a signed-in browser:
 * ours, an HttpOnly cookie backed by a `sessions` row, and Firebase's, held in
 * the browser's own storage. Destroying only ours looks like a sign-out and is
 * not one - the Firebase session survives, and anyone at that keyboard can mint
 * a fresh ID token from it and exchange it for a new application session
 * without knowing the password. That is precisely the "another user can access
 * the previous user's data" failure §16 is about.
 *
 * So the pair is packaged here and every menu uses it, rather than each
 * remembering to do both. `signOutOfFirebase` returns without doing anything
 * when Firebase is not configured, and swallows its own errors, so this is the
 * right call on every deployment.
 *
 * Order matters: Firebase first. `signOutAction` ends in a `redirect`, so
 * anything after it would run during a navigation away from this component.
 *
 * Application state (React Query's cache, Zustand's stores) needs no explicit
 * clearing here for the same reason: the redirect is a real navigation to
 * `/sign-in`, which tears down the tree and everything held in it.
 */
export function useSignOut(): { signOut: () => void; pending: boolean } {
  const [pending, startTransition] = useTransition();

  return {
    pending,
    signOut: () =>
      startTransition(async () => {
        await signOutOfFirebase();
        await signOutAction();
      }),
  };
}
