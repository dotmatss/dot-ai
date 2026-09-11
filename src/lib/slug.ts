/**
 * Converts arbitrary text into a URL-safe slug. Used for workspace, chatbot and
 * organization identifiers that appear in URLs.
 */
export function slugify(input: string, maxLength = 48): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

export function withSuffix(slug: string, attempt: number): string {
  return attempt === 0 ? slug : `${slug}-${attempt + 1}`;
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
