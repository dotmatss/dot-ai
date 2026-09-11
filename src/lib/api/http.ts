import { ApiError } from "./api-error";

export interface ApiSuccessEnvelope<T> {
  data: T;
}

export interface ApiFailureEnvelope {
  error: { code: string; message: string; details?: Record<string, string[] | undefined> };
}

type JsonInit = Omit<RequestInit, "body"> & { json?: unknown };

/**
 * Minimal typed HTTP client for same-origin API routes. Every response uses
 * the `{ data }` / `{ error }` envelope produced by `src/server/http`.
 */
export async function apiFetch<T>(path: string, init: JsonInit = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      // Marks browser-initiated API calls. Mutating routes require it as a
      // lightweight CSRF signal in addition to SameSite cookies and Origin checks.
      "X-Requested-With": "fetch",
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  let payload: unknown = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    payload = await response.json().catch(() => null);
  }

  if (!response.ok) {
    const errorPayload = (payload as ApiFailureEnvelope | null)?.error;
    throw ApiError.fromPayload(response.status, errorPayload);
  }

  return (payload as ApiSuccessEnvelope<T>).data;
}

export type QueryParamValue = string | number | boolean | undefined | null;

export function buildQueryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, QueryParamValue>)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
