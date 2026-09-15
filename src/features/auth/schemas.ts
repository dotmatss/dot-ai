import { z } from "zod";

export const emailSchema = z.email({ error: "Enter a valid email address" }).trim().toLowerCase().max(254);

export const passwordSchema = z
  .string()
  .min(8, { error: "Use at least 8 characters" })
  .max(128, { error: "Use at most 128 characters" });

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: "Enter your password" }),
  next: z.string().optional(),
});

export type SignInInput = z.infer<typeof signInSchema>;

/**
 * The invitation token as it arrives from a URL: opaque, fixed alphabet,
 * bounded. It lives here rather than with the other settings schemas because
 * the auth area is what parses it, and because settings/schemas.ts already
 * imports `emailSchema` from this module.
 */
export const invitationTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{20,128}$/, { error: "That invitation link is not valid" });

export const signUpSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter your name" }).max(80),
  organizationName: z.string().trim().min(2, { error: "Enter an organization name" }).max(80),
  email: emailSchema,
  password: passwordSchema,
});

export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * Signing up *through* an invitation.
 *
 * No organization name: the invitation names the organization, and creating a
 * second one for someone who was invited into an existing one is the bug this
 * separate schema exists to prevent. The email is still validated rather than
 * trusted from the link - the server re-checks it against the invitation.
 */
export const invitedSignUpSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter your name" }).max(80),
  email: emailSchema,
  password: passwordSchema,
  invitationToken: invitationTokenSchema,
});

export type InvitedSignUpInput = z.infer<typeof invitedSignUpSchema>;

/**
 * A Firebase ID token as it arrives from the browser.
 *
 * Shape only. This validates that the value is a three-part JWT of a sane
 * length so that obvious junk is rejected before any cryptography or database
 * work happens; it proves nothing about the token and is not a security check.
 * The security check is `verifyFirebaseIdToken`, which verifies the signature
 * against Google's published keys and every claim Firebase specifies.
 *
 * Nothing else about the caller is accepted from the client. There is
 * deliberately no `email`, `uid`, `emailVerified` or `role` field on any schema
 * below: every one of those is read from the verified token instead, which is
 * what §6 and §22 mean by never trusting the frontend for proof of identity.
 */
export const firebaseIdTokenSchema = z
  .string()
  .trim()
  .max(8192, { error: "That sign-in token is not valid" })
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, { error: "That sign-in token is not valid" });

export const firebaseSignInSchema = z.object({
  idToken: firebaseIdTokenSchema,
  next: z.string().optional(),
});

export type FirebaseSignInInput = z.infer<typeof firebaseSignInSchema>;

/**
 * The profile half of a Firebase registration.
 *
 * No email and no password: the browser gave both to Firebase directly, and
 * the address this account is created for comes from the verified token. What
 * is left is the two things Firebase has no opinion about - the person's name
 * and the organization to create for them.
 */
export const firebaseSignUpSchema = z.object({
  idToken: firebaseIdTokenSchema,
  /**
   * Optional because a Google registration has no name field to fill in - the
   * profile name rides in the verified token, which is a better source than a
   * form anyway. The email/password form still sends it, and either way the
   * token wins: see `identityFrom`.
   */
  name: z.string().trim().min(2, { error: "Enter your name" }).max(80).optional(),
  organizationName: z.string().trim().min(2, { error: "Enter an organization name" }).max(80),
});

export type FirebaseSignUpInput = z.infer<typeof firebaseSignUpSchema>;

export const firebaseInvitedSignUpSchema = z.object({
  idToken: firebaseIdTokenSchema,
  /** Optional for the same reason as above: a Google registration has none. */
  name: z.string().trim().min(2, { error: "Enter your name" }).max(80).optional(),
  invitationToken: invitationTokenSchema,
});

export type FirebaseInvitedSignUpInput = z.infer<typeof firebaseInvitedSignUpSchema>;
