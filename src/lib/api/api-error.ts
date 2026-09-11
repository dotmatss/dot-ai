export type ApiErrorCode =
  | "bad_request"
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
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

  constructor(code: ApiErrorCode, message: string, details?: ApiErrorDetails) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
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
  static rateLimited(message = "Too many requests") {
    return new ApiError("rate_limited", message);
  }
  static unavailable(message = "Service temporarily unavailable") {
    return new ApiError("unavailable", message);
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
    case "unavailable":
      return "Service temporarily unavailable";
    default:
      return "Something went wrong";
  }
}
