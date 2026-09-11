import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

/**
 * Copies server-side validation errors onto React Hook Form fields so the
 * same field-level UI shows both client and server validation results.
 */
export function applyFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  fieldErrors: Record<string, string[] | undefined> | undefined,
): void {
  if (!fieldErrors) return;
  for (const [field, messages] of Object.entries(fieldErrors)) {
    const message = messages?.[0];
    if (!message) continue;
    setError(field as Path<T>, { type: "server", message });
  }
}
