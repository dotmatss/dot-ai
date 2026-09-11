type ClassValue = string | number | bigint | null | false | undefined | ClassValue[];

/**
 * Joins class names, skipping falsy values. Intentionally minimal: components
 * in this codebase use explicit variant maps, so conflicting utilities are
 * avoided by construction rather than resolved at runtime.
 */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const value of values) {
    if (!value && value !== 0) continue;
    if (Array.isArray(value)) {
      const nested = cn(...value);
      if (nested) out.push(nested);
    } else {
      out.push(String(value));
    }
  }
  return out.join(" ");
}
