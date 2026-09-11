import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ApiError } from "@/lib/api/api-error";

export async function parseJsonBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw ApiError.badRequest("Request body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw ApiError.validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  }
  return parsed.data;
}

export function parseSearchParams<S extends z.ZodType>(request: NextRequest | Request, schema: S): z.output<S> {
  const url = new URL(request.url);
  const object: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    object[key] = value;
  });
  const parsed = schema.safeParse(object);
  if (!parsed.success) {
    throw ApiError.validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  }
  return parsed.data;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defense for cookie-authenticated API routes: browsers always send
 * Origin on cross-site mutating requests, so a mismatch (or a missing custom
 * header that simple cross-site forms cannot set) is rejected.
 */
export function assertSameOrigin(request: Request): void {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw ApiError.forbidden("Invalid request origin");
    }
    if (originHost !== host) throw ApiError.forbidden("Cross-origin request rejected");
  }
  if (request.headers.get("x-requested-with") !== "fetch") {
    throw ApiError.forbidden("Missing request marker");
  }
}

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const searchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
});
