import { CREDENTIAL_TYPES, type CredentialListFilters, type CredentialType } from "@/features/integrations/types";
import { DEFAULT_PAGE_SIZE } from "@/types/pagination";

/** Same contract as `parseApiKeyFilters` in `src/features/developer/`, for the credentials list. */
export function parseCredentialFilters(values: Record<string, string | string[] | undefined>): CredentialListFilters {
  const raw = (key: string) => {
    const value = values[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const typeValue = raw("type");
  const type =
    typeValue && (CREDENTIAL_TYPES as readonly string[]).includes(typeValue) ? (typeValue as CredentialType) : undefined;
  const search = raw("search")?.trim();
  const page = Number(raw("page") ?? 1);
  return {
    type,
    search: search && search.length > 0 ? search.slice(0, 120) : undefined,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}
