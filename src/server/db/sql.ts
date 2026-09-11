import "server-only";

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type Paginated } from "@/types/pagination";

/**
 * Small SQL composition helpers shared by repositories. They intentionally do
 * not build a query DSL; repositories still write explicit SQL.
 */

export interface PageInput {
  page?: number;
  pageSize?: number;
}

export function normalizePage(input: PageInput): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function toPaginated<T>(items: T[], total: number, page: { page: number; pageSize: number }): Paginated<T> {
  return { items, total, page: page.page, pageSize: page.pageSize };
}

/** Escapes LIKE wildcards in user-provided search terms. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Incrementally numbered positional parameters for dynamic WHERE clauses. */
export class ParamBuilder {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toIsoRequired(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
