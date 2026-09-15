"use client";

import { initializeApp, getApp, getApps, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from "firebase/auth";

import { getFirebaseClientConfig } from "@/config/firebase";

/**
 * The browser's half of Firebase Authentication.
 *
 * Everything that touches a password lives here and only here, because this is
 * the only code that runs in the user's browser: `createUserWithEmailAndPassword`
 * and `signInWithEmailAndPassword` send the password to Google over TLS, and it
 * never reaches our server at all. That is not an implementation detail - it is
 * the reason §3 can say PostgreSQL stores no passwords and mean it, rather than
 * meaning "we receive them and choose not to keep them".
 *
 * What our server gets is the ID token these functions return, which it
 * verifies (`src/server/auth/firebase/verify-id-token.ts`) before trusting a
 * single claim in it.
 */

let cachedApp: FirebaseApp | null = null;

/**
 * The Firebase app, created on first use.
 *
 * Lazy rather than module-scope so that importing this module - which the
 * sign-in page does unconditionally - cannot throw in a deployment that has no
 * Firebase configured. `getApps()` is checked because React strict mode and
 * fast refresh both re-run module bodies, and `initializeApp` twice under the
 * same name is an error.
 */
function firebaseApp(): FirebaseApp {
  if (cachedApp) return cachedApp;
  const config = getFirebaseClientConfig();
  if (!config) throw new Error("Firebase is not configured in this deployment.");
  cachedApp = getApps().length > 0 ? getApp() : initializeApp(config);
  return cachedApp;
}

export function firebaseAuth(): Auth {
  return getAuth(firebaseApp());
}

/**
 * Firebase errors, in words a person can act on.
 *
 * Firebase codes are precise and unreadable (`auth/invalid-credential`), and
 * some of them say more than we want to: answering "wrong password" versus "no
 * such user" turns the sign-in form into a way to enumerate which addresses
 * hold accounts. Modern Firebase already collapses those two into
 * `invalid-credential`, and this keeps them collapsed for the older codes too.
 *
 * The default deliberately does not include the raw code. It reaches the
 * console for debugging, not the person, who can do nothing with
 * `auth/internal-error`.
 */
export function firebaseErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  switch (code) {
    case "auth/email-already-in-use":
      return "An account already exists for this email address. Sign in instead.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
      return "Choose a stronger password - at least 8 characters.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact your administrator.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "Could not reach the sign-in service. Check your connection and try again.";
    case "auth/operation-not-allowed":
      return "Email and password sign-in is not enabled for this application.";
    case "auth/requires-recent-login":
      return "For security, sign in again before making this change.";
    // The person closed the Google window, or opened a second one. Neither is
    // an error worth shouting about, and "sign-in failed" for a deliberate
    // cancellation reads as a bug in the site.
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.";
    /**
     * Raised where the Firebase project is set to one account per email
     * address and that address was first registered by a different method.
     * The instruction is the useful part: the existing method still works, and
     * linking Google to it is a Firebase-side operation, not something to
     * improvise here.
     */
    case "auth/account-exists-with-different-credential":
      return "An account already exists for this email using a different sign-in method. Sign in that way instead.";
    /**
     * A configuration fault, not a user fault, and the single most likely
     * thing to be wrong the first time Google sign-in is switched on - the
     * deployment's domain has to be listed under Firebase Authentication ->
     * Settings -> Authorized domains. Named explicitly so it is diagnosed from
     * the screen rather than from a support ticket.
     */
    case "auth/unauthorized-domain":
      return "This site is not authorized for Google sign-in. Add its domain to the Firebase project's authorized domains.";
    case "auth/operation-not-supported-in-this-environment":
      return "Google sign-in is not available in this browser context.";
    default:
      if (code) console.error("[auth] unmapped Firebase error", code);
      return "Sign-in failed. Please try again.";
  }
}

/**
 * Persistence is set explicitly rather than left to the default.
 *
 * The default is already local storage, but "already" is not a guarantee, and
 * the session/verification flow depends on the Firebase user surviving the
 * redirect to the mailbox and back. Stating it makes that dependency visible
 * instead of inherited.
 */
async function ensurePersistence(auth: Auth): Promise<void> {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    // A browser with storage blocked still works for the duration of the
    // page: the ID token is exchanged for our own session cookie immediately,
    // and that cookie is what the application actually runs on.
  }
}

export interface FirebaseCredentialResult {
  idToken: string;
  emailVerified: boolean;
}

/**
 * Creates the Firebase account, sets the display name and sends Firebase's own
 * verification email.
 *
 * ── The already-in-use case ─────────────────────────────────────────────────
 *
 * Handled rather than reported, because it is the normal appearance of a
 * partly-completed registration: the Firebase account was created on a previous
 * attempt and the server step then failed (a reload, a lost connection, a
 * database blip). Reporting "email already in use" to that person would be
 * true and useless - they would go to the sign-in page, where they also have no
 * application account, and be stuck between two forms.
 *
 * So the same credentials are tried as a sign-in. If they work, this WAS that
 * person's half-finished registration and it resumes: the caller completes the
 * server half, which is idempotent, and they end up with exactly one account.
 * If they do not work, the address belongs to somebody else and the original
 * error stands.
 */
export async function createFirebaseAccount(input: {
  email: string;
  password: string;
  name: string;
}): Promise<FirebaseCredentialResult> {
  const auth = firebaseAuth();
  await ensurePersistence(auth);

  let user: User;
  try {
    const credential = await createUserWithEmailAndPassword(auth, input.email, input.password);
    user = credential.user;
    await updateProfile(user, { displayName: input.name });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code !== "auth/email-already-in-use") throw error;
    const credential = await signInWithEmailAndPassword(auth, input.email, input.password);
    user = credential.user;
  }

  if (!user.emailVerified) await sendVerificationEmail();

  // `true` forces a refresh so the token carries the profile just written,
  // rather than the one minted microseconds before `updateProfile`.
  return { idToken: await user.getIdToken(true), emailVerified: user.emailVerified };
}

/**
 * Google sign-in, through Firebase.
 *
 * Note what this does NOT add: a second identity system. Google is a sign-in
 * method *of* the Firebase project, so what comes back is an ordinary Firebase
 * ID token with the same `sub`, verified by the same code
 * (`verify-id-token.ts`) and resolved through the same `user_identities` row.
 * The only visible difference server-side is `firebase.sign_in_provider`,
 * which is recorded and not acted on.
 *
 * ── Why these accounts skip the verification gate ───────────────────────────
 *
 * They do not skip it - they satisfy it. A Google token carries
 * `email_verified: true` because Google has already proved the address, so the
 * mirror in `users.email_verified` is set from that claim exactly as it would
 * be after somebody clicked a link in a verification email. Nothing is waived;
 * the proof simply already exists.
 *
 * ── Popup, not redirect ─────────────────────────────────────────────────────
 *
 * The redirect flow means handling `getRedirectResult` on page load, on every
 * page that could be returned to, and carrying the pending organization name
 * across a full navigation. The popup keeps the whole exchange inside one
 * component, at the cost of needing `auth/popup-blocked` mapped to something a
 * person can act on - which `firebaseErrorMessage` does.
 */
export async function signInWithGoogle(): Promise<FirebaseCredentialResult & { displayName: string | null }> {
  const auth = firebaseAuth();
  await ensurePersistence(auth);

  const provider = new GoogleAuthProvider();
  // Always ask which account to use. Without this, a browser signed into one
  // Google account silently reuses it, which is the wrong default on a shared
  // machine and impossible to recover from without clearing Google's cookies.
  provider.setCustomParameters({ prompt: "select_account" });

  const credential = await signInWithPopup(auth, provider);
  return {
    idToken: await credential.user.getIdToken(),
    emailVerified: credential.user.emailVerified,
    displayName: credential.user.displayName,
  };
}

export async function signInToFirebase(email: string, password: string): Promise<FirebaseCredentialResult> {
  const auth = firebaseAuth();
  await ensurePersistence(auth);
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return { idToken: await credential.user.getIdToken(), emailVerified: credential.user.emailVerified };
}

/**
 * Sends (or resends) Firebase's verification email to the signed-in user.
 *
 * Firebase owns the template, the link, the token and its expiry. There is no
 * verification token in our database and no route that consumes one - §7 asks
 * for exactly that, and it is also the only way the "click the link" step can
 * be trusted, since Firebase is what records the result.
 */
export async function sendVerificationEmail(): Promise<void> {
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error("Sign in again to send a verification email.");
  await sendEmailVerification(user);
}

/**
 * Re-reads verification state from Firebase and returns a fresh ID token.
 *
 * `reload` re-fetches the user from Firebase, so `emailVerified` reflects the
 * link the person just clicked in another tab. `getIdToken(true)` then forces a
 * new token carrying the updated claim - without the force, the cached token
 * would keep saying `email_verified: false` for up to an hour, and the server
 * would keep believing it, correctly.
 *
 * The boolean returned here is only for rendering. What the server acts on is
 * the token, which it verifies itself.
 */
export async function refreshVerificationState(): Promise<{ idToken: string; emailVerified: boolean } | null> {
  const user = firebaseAuth().currentUser;
  if (!user) return null;
  await reload(user);
  return { idToken: await user.getIdToken(true), emailVerified: user.emailVerified };
}

/** Firebase's own password reset. No token, template or route of ours. */
export async function sendFirebasePasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(firebaseAuth(), email);
}

/**
 * Ends the Firebase browser session.
 *
 * Must be called alongside the server sign-out, never instead of it: the two
 * sessions are independent, and leaving the Firebase one alive would let the
 * next person at the keyboard mint a fresh ID token for the previous user and
 * exchange it for a new application session - the exact failure §16 describes.
 * `SignOutButton` is what keeps them together.
 */
export async function signOutOfFirebase(): Promise<void> {
  if (!getFirebaseClientConfig()) return;
  try {
    await signOut(firebaseAuth());
  } catch (error) {
    // Never block the application sign-out on this. The server session is what
    // grants access, and it is being destroyed regardless.
    console.error("[auth] could not sign out of Firebase", error);
  }
}
