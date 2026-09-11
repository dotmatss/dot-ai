import type { ContactProperties } from "@/features/crm/types";

/**
 * Human descriptions of what changed on a contact. They are written to
 * `contact_activities.description` and read straight back out in the timeline,
 * so they live in a pure module the UI and the service can both rely on.
 */

export function formatList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

export function describeTagChange(added: string[], removed: string[]): string {
  const parts: string[] = [];
  if (added.length > 0) parts.push(`added ${formatList(added.map((tag) => `“${tag}”`))}`);
  if (removed.length > 0) parts.push(`removed ${formatList(removed.map((tag) => `“${tag}”`))}`);
  return parts.length > 0 ? `Tags ${parts.join(", ")}` : "Tags unchanged";
}

export interface PropertyDiff {
  added: string[];
  updated: string[];
  removed: string[];
}

export function diffProperties(before: ContactProperties, after: ContactProperties): PropertyDiff {
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  for (const [key, value] of Object.entries(after)) {
    if (!(key in before)) added.push(key);
    else if (before[key] !== value) updated.push(key);
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) removed.push(key);
  }
  return { added, updated, removed };
}

export function hasPropertyChange(diff: PropertyDiff): boolean {
  return diff.added.length > 0 || diff.updated.length > 0 || diff.removed.length > 0;
}

export function describePropertyChange(diff: PropertyDiff): string {
  const parts: string[] = [];
  if (diff.added.length > 0) parts.push(`added ${formatList(diff.added)}`);
  if (diff.updated.length > 0) parts.push(`changed ${formatList(diff.updated)}`);
  if (diff.removed.length > 0) parts.push(`removed ${formatList(diff.removed)}`);
  return parts.length > 0 ? `Properties ${parts.join(", ")}` : "Properties unchanged";
}
