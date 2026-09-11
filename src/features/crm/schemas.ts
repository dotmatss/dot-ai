import { z } from "zod";

import {
  MAX_COMPANY_LENGTH,
  MAX_CUSTOM_PROPERTIES,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PHONE_LENGTH,
  MAX_PROPERTY_KEY_LENGTH,
  MAX_PROPERTY_VALUE_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CONTACT,
  PROPERTY_KEY_PATTERN,
} from "@/features/crm/constants";
import { normalizeTags } from "@/features/crm/normalize";
import { CONTACT_STAGES } from "@/features/crm/types";

export const contactStageSchema = z.enum(CONTACT_STAGES);

/** Stored email form: trimmed and lowercased before the format check. */
export const contactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address" }).max(MAX_EMAIL_LENGTH, { error: "That email address is too long" }));

/** Optional email as a form field sends it: the empty string means "not set". */
export const contactEmailFieldSchema = z.union([z.literal(""), contactEmailSchema]);

/** Optional email over the wire: "", null and a valid address all collapse to `string | null`. */
const nullableEmail = z.union([z.literal(""), z.null(), contactEmailSchema]).transform((value) => value || null);

const nullableText = (max: number, error: string) =>
  z
    .union([z.string().trim().max(max, { error }), z.null()])
    .transform((value) => (value && value.length > 0 ? value : null));

export const contactTagSchema = z
  .string()
  .trim()
  .min(1, { error: "Tags cannot be empty" })
  .max(MAX_TAG_LENGTH, { error: `Keep tags under ${MAX_TAG_LENGTH} characters` });

/** Tags are normalized here so the client and the server store the same array. */
export const contactTagsSchema = z
  .array(contactTagSchema)
  .max(MAX_TAGS_PER_CONTACT, { error: `Up to ${MAX_TAGS_PER_CONTACT} tags` })
  .transform(normalizeTags);

export const contactPropertyKeySchema = z
  .string()
  .trim()
  .min(1, { error: "Enter a property name" })
  .max(MAX_PROPERTY_KEY_LENGTH, { error: `Keep property names under ${MAX_PROPERTY_KEY_LENGTH} characters` })
  .regex(PROPERTY_KEY_PATTERN, { error: "Use letters, numbers, spaces, hyphens and underscores" });

export const contactPropertyValueSchema = z
  .string()
  .trim()
  .max(MAX_PROPERTY_VALUE_LENGTH, { error: `Keep values under ${MAX_PROPERTY_VALUE_LENGTH} characters` });

/** The whole custom-property map is replaced on write, so the cap applies here. */
export const contactPropertiesSchema = z
  .record(contactPropertyKeySchema, contactPropertyValueSchema)
  .refine((value) => Object.keys(value).length <= MAX_CUSTOM_PROPERTIES, {
    error: `Up to ${MAX_CUSTOM_PROPERTIES} custom properties`,
  });

const contactWritableSchema = z.object({
  name: nullableText(MAX_NAME_LENGTH, `Keep the name under ${MAX_NAME_LENGTH} characters`).optional(),
  email: nullableEmail.optional(),
  phone: nullableText(MAX_PHONE_LENGTH, "That phone number is too long").optional(),
  company: nullableText(MAX_COMPANY_LENGTH, `Keep the company under ${MAX_COMPANY_LENGTH} characters`).optional(),
  source: nullableText(MAX_SOURCE_LENGTH, "That source is too long").optional(),
  stage: contactStageSchema.optional(),
  tags: contactTagsSchema.optional(),
});

/**
 * A contact with neither a name nor an email cannot be identified in a list,
 * so one of them is required at creation. Updates re-check the same rule
 * against the merged record in the service, because a PATCH sends only the
 * fields it changes.
 */
export const createContactSchema = contactWritableSchema.refine((value) => Boolean(value.name || value.email), {
  error: "Enter a name or an email address",
  path: ["name"],
});

export type CreateContactInput = z.input<typeof createContactSchema>;

export const updateContactSchema = contactWritableSchema
  .extend({ properties: contactPropertiesSchema.optional() })
  .refine((value) => Object.keys(value).length > 0, { error: "Nothing to update" });

export type UpdateContactInput = z.input<typeof updateContactSchema>;

export const contactListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  stage: contactStageSchema.optional(),
  tag: z.string().trim().toLowerCase().max(MAX_TAG_LENGTH).optional(),
});

/** Pagination for the contact detail tabs (notes, activity, conversations). */
export const contactSubListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createContactNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, { error: "Write a note first" })
    .max(MAX_NOTE_LENGTH, { error: `Keep notes under ${MAX_NOTE_LENGTH.toLocaleString("en")} characters` }),
});

export type CreateContactNoteInput = z.infer<typeof createContactNoteSchema>;

/* -------------------------------------------------------------------------- */
/* Form-facing schemas                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The create/edit dialog works with plain strings (an untouched optional input
 * sends ""), so it gets its own schema and the component maps to the API shape.
 */
export const contactFormSchema = z
  .object({
    name: z.string().trim().max(MAX_NAME_LENGTH, { error: `Keep the name under ${MAX_NAME_LENGTH} characters` }),
    email: contactEmailFieldSchema,
    phone: z.string().trim().max(MAX_PHONE_LENGTH, { error: "That phone number is too long" }),
    company: z.string().trim().max(MAX_COMPANY_LENGTH, { error: `Keep the company under ${MAX_COMPANY_LENGTH} characters` }),
    stage: contactStageSchema,
    tags: z.array(contactTagSchema).max(MAX_TAGS_PER_CONTACT, { error: `Up to ${MAX_TAGS_PER_CONTACT} tags` }),
  })
  .refine((value) => value.name.length > 0 || value.email.length > 0, {
    error: "Enter a name or an email address",
    path: ["name"],
  });

export type ContactFormValues = z.infer<typeof contactFormSchema>;

export const contactNoteFormSchema = createContactNoteSchema;
export type ContactNoteFormValues = z.infer<typeof contactNoteFormSchema>;
