import { PLATFORM_PAGE_SIZE } from "@/features/platform/schemas";
import {
  ORGANIZATION_STATUSES,
  type OrganizationStatus,
  type PlatformAuditFilters,
  type PlatformOrganizationFilters,
  type PlatformUserFilters,
} from "@/features/platform/types";

/**
 * URL parameters -> list filters, shared by the server pages (for prefetch) and
 * the client tables, so both derive an identical query key.
 *
 * Garbage is dropped rather than rejected, matching `parseAuditFilters`: a
 * stale or hand-edited URL renders the unfiltered list instead of a 500.
 */

type RawParams = Record<string, string | string[] | undefined>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;

export const ORGANIZATION_FILTER_KEYS = ["q", "status", "page"] as const;
export const USER_FILTER_KEYS = ["q", "state", "page"] as const;
export const PLATFORM_AUDIT_FILTER_KEYS = ["q", "action", "result", "from", "to", "page"] as const;

function first(values: RawParams, key: string): string | undefined {
  const value = values[key];
  return Array.isArray(value) ? value[0] : value;
}

function pageFrom(values: RawParams): number {
  const raw = Number(first(values, "page") ?? 1);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

function searchFrom(values: RawParams): string | undefined {
  const q = first(values, "q")?.trim();
  return q ? q.slice(0, 200) : undefined;
}

/**
 * Same trap as the audit filters: the pattern proves the shape, but `Date`
 * rolls 2026-02-31 over to 3 March while PostgreSQL raises on the cast. Round
 * tripping is what stops an invented date reaching the database.
 */
function dateOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !DATE_PATTERN.test(trimmed)) return undefined;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : undefined;
}

export function parseOrganizationFilters(values: RawParams): PlatformOrganizationFilters {
  const statusRaw = first(values, "status")?.trim();
  const status = ORGANIZATION_STATUSES.includes(statusRaw as OrganizationStatus)
    ? (statusRaw as OrganizationStatus)
    : undefined;

  return { q: searchFrom(values), status, page: pageFrom(values), pageSize: PLATFORM_PAGE_SIZE };
}

export function parseUserFilters(values: RawParams): PlatformUserFilters {
  const stateRaw = first(values, "state")?.trim();
  const state = stateRaw === "active" || stateRaw === "disabled" ? stateRaw : undefined;

  return { q: searchFrom(values), state, page: pageFrom(values), pageSize: PLATFORM_PAGE_SIZE };
}

export function parsePlatformAuditFilters(values: RawParams): PlatformAuditFilters {
  const actionRaw = first(values, "action")?.trim();
  const resultRaw = first(values, "result")?.trim();

  let from = dateOrUndefined(first(values, "from"));
  let to = dateOrUndefined(first(values, "to"));
  // An inverted range returns nothing and reads like a bug in the page. Swap it.
  if (from && to && from > to) [from, to] = [to, from];

  return {
    q: searchFrom(values),
    action: actionRaw && TOKEN_PATTERN.test(actionRaw) ? actionRaw : undefined,
    result: resultRaw === "success" || resultRaw === "denied" || resultRaw === "error" ? resultRaw : undefined,
    from,
    to,
    page: pageFrom(values),
    pageSize: PLATFORM_PAGE_SIZE,
  };
}

export function hasOrganizationFilters(filters: PlatformOrganizationFilters): boolean {
  return Boolean(filters.q || filters.status);
}

export function hasUserFilters(filters: PlatformUserFilters): boolean {
  return Boolean(filters.q || filters.state);
}

export function hasPlatformAuditFilters(filters: PlatformAuditFilters): boolean {
  return Boolean(filters.q || filters.action || filters.result || filters.from || filters.to);
}
