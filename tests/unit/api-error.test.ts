import { describe, expect, it } from "vitest";

import { ApiError, isApiError } from "@/lib/api/api-error";
import { buildQueryString } from "@/lib/api/http";

describe("ApiError", () => {
  it("maps codes to HTTP statuses", () => {
    expect(ApiError.notFound().status).toBe(404);
    expect(ApiError.validation({ name: ["Required"] }).status).toBe(422);
    expect(ApiError.rateLimited().status).toBe(429);
  });

  it("round-trips through the wire payload", () => {
    const original = ApiError.validation({ email: ["Invalid"] }, "Check fields");
    const revived = ApiError.fromPayload(422, original.toPayload());
    expect(isApiError(revived)).toBe(true);
    expect(revived.code).toBe("validation_error");
    expect(revived.message).toBe("Check fields");
    expect(revived.details).toEqual({ email: ["Invalid"] });
  });

  it("falls back to a status-derived code for unknown payloads", () => {
    expect(ApiError.fromPayload(403, undefined).code).toBe("forbidden");
    expect(ApiError.fromPayload(500, { nonsense: true }).code).toBe("internal_error");
  });
});

describe("buildQueryString", () => {
  it("omits empty values and encodes the rest", () => {
    expect(buildQueryString({ q: "hello world", page: 2, status: undefined, empty: "", flag: true })).toBe("?q=hello+world&page=2&flag=true");
    expect(buildQueryString({})).toBe("");
  });
});
