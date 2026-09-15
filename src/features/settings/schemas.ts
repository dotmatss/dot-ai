import { z } from "zod";

import { emailSchema } from "@/features/auth/schemas";
import {
  MAX_AVATAR_URL_LENGTH,
  MAX_USER_NAME_LENGTH,
  MAX_WORKSPACE_NAME_LENGTH,
} from "@/features/settings/constants";
import { MEMBER_ROLES } from "@/features/workspaces/roles";

/** Shared by the route handlers (server) and the forms (client). */

export const memberRoleSchema = z.enum(MEMBER_ROLES);

export const updateWorkspaceNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "Enter a workspace name" })
    .max(MAX_WORKSPACE_NAME_LENGTH, { error: `Keep the name under ${MAX_WORKSPACE_NAME_LENGTH} characters` }),
});

export type UpdateWorkspaceNameInput = z.infer<typeof updateWorkspaceNameSchema>;

/** The General form has exactly one editable field, so it reuses the wire schema. */
export const workspaceGeneralFormSchema = updateWorkspaceNameSchema;
export type WorkspaceGeneralFormValues = z.infer<typeof workspaceGeneralFormSchema>;

export const updateMemberRoleSchema = z.object({ role: memberRoleSchema });
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

/**
 * Inviting reuses `emailSchema` from auth so an invitation and the sign-up it
 * leads to normalise the address identically - lowercased and trimmed. A
 * mismatch there would mean an invitation nobody can accept.
 */
export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: memberRoleSchema,
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/** The form defaults to the least privileged role that can still do work. */
export const inviteMemberFormSchema = inviteMemberSchema;
export type InviteMemberFormValues = z.infer<typeof inviteMemberFormSchema>;

/**
 * Avatars are rendered in an `<img>`, never fetched by the server, so the only
 * thing that matters is that the value is a URL the browser will load over
 * HTTP(S) - `javascript:` and `data:` are rejected here rather than at render
 * time. `new URL` is the check because it is the same parser the browser uses.
 */
const httpUrlSchema = z
  .string()
  .trim()
  .max(MAX_AVATAR_URL_LENGTH, { error: "That link is too long" })
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { error: "Enter a link starting with http:// or https://" },
  );

/** Form shape: an untouched optional input sends "", which means "no avatar". */
export const avatarUrlFieldSchema = z.union([z.literal(""), httpUrlSchema]);

const userNameSchema = z
  .string()
  .trim()
  .min(1, { error: "Enter your name" })
  .max(MAX_USER_NAME_LENGTH, { error: `Keep your name under ${MAX_USER_NAME_LENGTH} characters` });

/** Wire shape: "", null and a valid link all collapse to `string | null`. */
export const updateProfileSchema = z.object({
  name: userNameSchema,
  avatarUrl: z
    .union([z.literal(""), z.null(), httpUrlSchema])
    .transform((value) => value || null),
});

export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

export const profileFormSchema = z.object({
  name: userNameSchema,
  avatarUrl: avatarUrlFieldSchema,
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;
