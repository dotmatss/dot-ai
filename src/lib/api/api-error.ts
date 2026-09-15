/**
 * The four protection codes are separate values rather than one `rate_limited`
 * because they call for four different actions. "Retry in 30s" is correct for a
 * rate limit and actively misleading for an exhausted monthly quota, where the
 * answer is to upgrade or wait for the period to roll; "too many at once" is
 * fixed by reducing parallelism, not by slowing down. A client that cannot tell
 * them apart can only guess, and usually guesses "retry harder".
 *
 * They are additive: `codeFromStatus` already degrades an unrecognised code to
 * the status-derived one, so a client built against the older list keeps working.
 */
export type ApiErrorCode =
  | "bad_request"
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "quota_exceeded"
  | "concurrency_limit"
  | "not_entitled"
  | "suspended"
  | "unavailable"
  | "internal_error";

export type ApiErrorDetails = Record<string, string[] | undefined>;

export interface ApiErrorPayload {
  code: ApiErrorCode;
  message: string;
  details?: ApiErrorDetails;
}

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  validation_error: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  quota_exceeded: 429,
  concurrency_limit: 429,
  not_entitled: 403,
  suspended: 403,
  unavailable: 503,
  internal_error: 500,
};

/**
 * Shared error shape for the HTTP boundary. Thrown on the server by services
 * and route handlers, and re-hydrated on the client by the API client so UI
 * code can branch on `code` instead of parsing messages.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: ApiErrorDetails;
  /**
   * Retry guidance, emitted as the `Retry-After` header by `fail()`.
   *
   * Carried on the error rather than passed to the response helper so that any
   * error thrown anywhere reaches `toErrorResponse` with its guidance intact -
   * a service deep in a call stack has no access to the response builder.
   *
   * Deliberately NOT in the payload: it is transport guidance, the message
   * already states it in words, and a number in the body would be one more
   * thing for a client to parse and get wrong.
   */
  readonly retryAfterSeconds?: number;

  constructor(code: ApiErrorCode, message: string, details?: ApiErrorDetails, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  toPayload(): ApiErrorPayload {
    return { code: this.code, message: this.message, details: this.details };
  }

  static fromPayload(status: number, payload: unknown): ApiError {
    if (isApiErrorPayload(payload)) {
      return new ApiError(payload.code, payload.message, payload.details);
    }
    const code = codeFromStatus(status);
    return new ApiError(code, defaultMessageForCode(code));
  }

  static badRequest(message = "Bad request") {
    return new ApiError("bad_request", message);
  }
  static validation(details: ApiErrorDetails, message = "Validation failed") {
    return new ApiError("validation_error", message, details);
  }
  static unauthorized(message = "Authentication required") {
    return new ApiError("unauthorized", message);
  }
  static forbidden(message = "You do not have access to this resource") {
    return new ApiError("forbidden", message);
  }
  static notFound(message = "Not found") {
    return new ApiError("not_found", message);
  }
  static conflict(message = "Conflict") {
    return new ApiError("conflict", message);
  }
  static rateLimited(message = "Too many requests", retryAfterSeconds?: number) {
    return new ApiError("rate_limited", message, undefined, retryAfterSeconds);
  }
  /**
   * The period's allowance is spent. No `Retry-After` by default: the honest
   * answer is "when your billing period rolls", and a header promising a
   * retry in seconds would invite exactly the hammering it should prevent.
   */
  static quotaExceeded(message = "This workspace has used its allowance for the current period") {
    return new ApiError("quota_exceeded", message);
  }
  static concurrencyLimit(message = "Too many operations running at once. Wait for one to finish.", retryAfterSeconds?: number) {
    return new ApiError("concurrency_limit", message, undefined, retryAfterSeconds);
  }
  static notEntitled(message = "This plan does not include that capability") {
    return new ApiError("not_entitled", message);
  }
  static suspended(message = "This account is suspended") {
    return new ApiError("suspended", message);
  }
  static unavailable(message = "Service temporarily unavailable", retryAfterSeconds?: number) {
    return new ApiError("unavailable", message, undefined, retryAfterSeconds);
  }
  static internal(message = "Something went wrong") {
    return new ApiError("internal_error", message);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === "string" && typeof v.message === "string" && v.code in STATUS_BY_CODE;
}

function codeFromStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 422:
      return "validation_error";
    case 429:
      return "rate_limited";
    case 503:
      return "unavailable";
    default:
      return "internal_error";
  }
}

function defaultMessageForCode(code: ApiErrorCode): string {
  switch (code) {
    case "unauthorized":
      return "Authentication required";
    case "forbidden":
      return "You do not have access to this resource";
    case "not_found":
      return "Not found";
    case "rate_limited":
      return "Too many requests";
    case "quota_exceeded":
      return "This workspace has used its allowance for the current period";
    case "concurrency_limit":
      return "Too many operations running at once";
    case "not_entitled":
      return "This plan does not include that capability";
    case "suspended":
      return "This account is suspended";
    case "unavailable":
      return "Service temporarily unavailable";
    default:
      return "Something went wrong";
  }
}
