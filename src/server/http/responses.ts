import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError } from "@/lib/api/api-error";
import { DatabaseUnavailableError } from "@/server/db/errors";

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, { status: 200, ...init });
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ data }, { status: 201 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/**
 * The one place an `ApiError` becomes a response.
 *
 * `Retry-After` is emitted here rather than at each throw site so that every
 * refusal in the application - including ones thrown by a service several
 * frames below the route - carries its guidance without the route having to
 * know. The header is the standard, machine-readable half of what the message
 * already says in words.
 */
export function fail(error: ApiError): NextResponse {
  const headers: Record<string, string> = {};
  if (error.retryAfterSeconds !== undefined) {
    // Whole seconds, and at least one: `Retry-After: 0` reads as "retry
    // immediately", which is the opposite of what a refusal means.
    headers["Retry-After"] = String(Math.max(1, Math.ceil(error.retryAfterSeconds)));
  }
  return NextResponse.json({ error: error.toPayload() }, { status: error.status, headers });
}

/** Maps any thrown value to a consistent error response. */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) return fail(error);
  if (error instanceof z.ZodError) {
    return fail(ApiError.validation(z.flattenError(error).fieldErrors as Record<string, string[]>));
  }
  if (error instanceof DatabaseUnavailableError) {
    console.error("[api] database unavailable:", error.message);
    return fail(ApiError.unavailable("Database unavailable"));
  }
  if (isNextInterrupt(error)) throw error;
  console.error("[api] unhandled error", error);
  return fail(ApiError.internal());
}

/** `redirect()`, `notFound()` and friends throw control-flow errors that must propagate. */
function isNextInterrupt(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_") || digest.includes("NEXT_HTTP_ERROR_FALLBACK"));
}
