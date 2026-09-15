import type { AuditListFilters } from "@/features/audit/types";
import { AUDIT_PAGE_SIZE } from "@/features/audit/constants";

/**
 * URL parameters -> list filters, shared by the server page (for prefetch) and
 * the client table, so both derive an identical query key.
 *
 * Garbage is dropped rather than rejected: a hand-edited or stale URL should
 * render the unfiltered log, not a 500. That is the same contract as
 * `parseConversationFilters`.
 */

type RawParams = Record<string, string | string[] | undefined>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Matches what services actually write: letters, digits, _ . : - */
const TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;

export const AUDIT_FILTER_KEYS = ["q", "actorId", "entityType", "action", "from", "to", "page"] as const;
export type AuditFilterKey = (typeof AUDIT_FILTER_KEYS)[number];

function first(values: RawParams, key: string): string | undefined {
  const value = values[key];
  return Array.isArray(value) ? value[0] : value;
}

function tokenOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && TOKEN_PATTERN.test(trimmed) ? trimmed : undefined;
}

function dateOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !DATE_PATTERN.test(trimmed)) return undefined;

  // The pattern only proves the shape, and `Date` silently rolls a bad day
  // over - 2026-02-31 parses as 3 March. PostgreSQL does not: `'2026-02-31'
  // ::date` raises "date/time field value out of range", so a URL nobody
  // validated would reach the database and come back a 500. Round-tripping the
  // parsed date is what catches it.
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : undefined;
}

export function parseAuditFilters(values: RawParams): AuditListFilters {
  const actorRaw = first(values, "actorId")?.trim();
  const actorId = actorRaw && UUID_PATTERN.test(actorRaw) ? actorRaw.toLowerCase() : undefined;

  let from = dateOrUndefined(first(values, "from"));
  let to = dateOrUndefined(first(values, "to"));
  // An inverted range returns nothing and reads like a bug in the page. Swap it.
  if (from && to && from > to) [from, to] = [to, from];

  const pageRaw = Number(first(values, "page") ?? 1);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  const q = first(values, "q")?.trim();

  return {
    q: q ? q.slice(0, 200) : undefined,
    actorId,
    entityType: tokenOrUndefined(first(values, "entityType")),
    action: tokenOrUndefined(first(values, "action")),
    from,
    to,
    page,
    pageSize: AUDIT_PAGE_SIZE,
  };
}

/** True when anything beyond paging is narrowing the list. */
export function hasAuditFilters(filters: AuditListFilters): boolean {
  return Boolean(filters.q || filters.actorId || filters.entityType || filters.action || filters.from || filters.to);
}
