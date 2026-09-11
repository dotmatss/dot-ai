import {
  MAX_CUSTOM_PROPERTIES,
  MAX_PROPERTY_KEY_LENGTH,
  MAX_PROPERTY_VALUE_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CONTACT,
  PROPERTY_KEY_PATTERN,
} from "@/features/crm/constants";
import type { ContactProperties } from "@/features/crm/types";

/**
 * Normalization rules for contact identity and labels. They live in one pure
 * module because three callers must agree on them: the Zod schemas (so the UI
 * validates what the server stores), the service (so `upsertContactByEmail`
 * matches existing rows), and the list filters (so a tag chip matches the
 * stored tag).
 */

/**
 * The stored form of an email address. The column is `citext`, so matching is
 * already case-insensitive; lowercasing keeps what is displayed and what is
 * compared in application code identical.
 */
export function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/** A single tag: lowercase, internal whitespace collapsed, length-capped. */
export function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH).trim();
}

/**
 * Tags as stored: normalized, de-duplicated, first occurrence wins so the
 * user's ordering survives, and capped so one contact cannot carry an
 * unbounded array into every list query.
 */
export function normalizeTags(values: readonly string[] | null | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_CONTACT) break;
  }
  return out;
}

export function isValidPropertyKey(key: string): boolean {
  const trimmed = key.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_PROPERTY_KEY_LENGTH && PROPERTY_KEY_PATTERN.test(trimmed);
}

/**
 * Custom properties as stored: trimmed keys, string values, invalid keys
 * dropped rather than rejected (an integration writing one bad key should not
 * make the whole record unreadable), and capped.
 */
export function normalizeProperties(input: Record<string, unknown> | null | undefined): ContactProperties {
  if (!input) return {};
  const out: ContactProperties = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.trim();
    if (!isValidPropertyKey(key)) continue;
    const value = propertyValueToString(rawValue);
    if (value === null) continue;
    out[key] = value.slice(0, MAX_PROPERTY_VALUE_LENGTH);
    if (Object.keys(out).length >= MAX_CUSTOM_PROPERTIES) break;
  }
  return out;
}

/**
 * Renders a jsonb value as editable text. Objects and arrays become JSON so
 * data written by an integration is visible instead of silently missing.
 */
function propertyValueToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/** Name shown wherever a contact is referenced; never an empty string. */
export function contactDisplayName(contact: { name?: string | null; email?: string | null }): string {
  const name = contact.name?.trim();
  if (name) return name;
  const email = contact.email?.trim();
  if (email) return email;
  return "Unnamed contact";
}

/**
 * Seed for the initials avatar. An email-only contact gets initials from the
 * local part ("ada.lovelace@x.com" → "AL") instead of a useless "@".
 */
export function contactAvatarSeed(contact: { name?: string | null; email?: string | null }): string {
  const name = contact.name?.trim();
  if (name) return name;
  const email = contact.email?.trim();
  if (!email) return "Unnamed contact";
  const local = email.split("@")[0] ?? email;
  return local.replace(/[._-]+/g, " ").trim() || email;
}
