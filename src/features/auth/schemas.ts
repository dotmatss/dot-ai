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

export const signUpSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter your name" }).max(80),
  organizationName: z.string().trim().min(2, { error: "Enter an organization name" }).max(80),
  email: emailSchema,
  password: passwordSchema,
});

export type SignUpInput = z.infer<typeof signUpSchema>;
