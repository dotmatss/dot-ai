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
