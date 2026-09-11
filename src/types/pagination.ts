export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

export function emptyPage<T>(page = 1, pageSize = DEFAULT_PAGE_SIZE): Paginated<T> {
  return { items: [], page, pageSize, total: 0 };
}
