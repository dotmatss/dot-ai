// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { isApiError } from "@/lib/api/api-error";
import { assertSameOrigin, paginationQuerySchema, parseJsonBody, parseSearchParams, searchQuerySchema } from "@/server/http/request";

const APP_ORIGIN = "http://localhost:3000";

function request(method: string, headers: Record<string, string> = {}, body?: unknown): Request {
  return new Request(`${APP_ORIGIN}/api/v1/w/acme/chatbots`, {
    method,
    headers: { host: "localhost:3000", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return isApiError(error) ? error.code : `unexpected:${String(error)}`;
  }
  return "no-error";
}

describe("assertSameOrigin", () => {
  it("lets safe methods through untouched", () => {
    expect(codeOf(() => assertSameOrigin(request("GET")))).toBe("no-error");
    expect(codeOf(() => assertSameOrigin(request("HEAD")))).toBe("no-error");
  });

  it("accepts a same-origin mutation that carries the fetch marker", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        codeOf(() => assertSameOrigin(request(method, { origin: APP_ORIGIN, "x-requested-with": "fetch" }))),
      ).toBe("no-error");
    }
  });

  it("rejects a cross-origin mutation", () => {
    // A browser always sends Origin on a cross-site mutating request.
    expect(
      codeOf(() => assertSameOrigin(request("POST", { origin: "https://evil.example", "x-requested-with": "fetch" }))),
    ).toBe("forbidden");
  });

  it("rejects an unparseable origin instead of trusting it", () => {
    expect(codeOf(() => assertSameOrigin(request("POST", { origin: "not-a-url", "x-requested-with": "fetch" })))).toBe(
      "forbidden",
    );
  });

  it("requires the fetch marker, which a cross-site form cannot set", () => {
    expect(codeOf(() => assertSameOrigin(request("POST", { origin: APP_ORIGIN })))).toBe("forbidden");
    // Not even a same-origin request is exempt: the marker is what defeats
    // form-based CSRF, where no Origin check would apply.
    expect(codeOf(() => assertSameOrigin(request("POST")))).toBe("forbidden");
  });

  it("compares against the forwarded host when the app sits behind a proxy", () => {
    const forwarded = new Request("http://internal:3000/api/v1/w/acme/chatbots", {
      method: "POST",
      headers: {
        host: "internal:3000",
        "x-forwarded-host": "app.example.com",
        origin: "https://app.example.com",
        "x-requested-with": "fetch",
      },
    });
    expect(codeOf(() => assertSameOrigin(forwarded))).toBe("no-error");
  });
});

describe("parseJsonBody", () => {
  const schema = z.object({ name: z.string().min(2), count: z.number().int().optional() });

  it("returns the parsed value", async () => {
    await expect(parseJsonBody(request("POST", {}, { name: "Support" }), schema)).resolves.toEqual({ name: "Support" });
  });

  it("reports invalid JSON as a bad request", async () => {
    await expect(parseJsonBody(request("POST", {}, "{not json"), schema)).rejects.toSatisfy(
      (error) => isApiError(error) && error.code === "bad_request",
    );
  });

  it("reports schema failures per field so forms can show them", async () => {
    await expect(parseJsonBody(request("POST", {}, { name: "x" }), schema)).rejects.toSatisfy(
      (error) => isApiError(error) && error.code === "validation_error" && Array.isArray(error.details?.name),
    );
  });
});

describe("parseSearchParams", () => {
  function get(query: string): Request {
    return new Request(`${APP_ORIGIN}/api/v1/w/acme/chatbots${query}`);
  }

  it("applies defaults and coerces numbers", () => {
    expect(parseSearchParams(get(""), paginationQuerySchema)).toEqual({ page: 1, pageSize: 20 });
    expect(parseSearchParams(get("?page=3&pageSize=50"), paginationQuerySchema)).toEqual({ page: 3, pageSize: 50 });
  });

  it("rejects values outside the allowed range rather than clamping silently", () => {
    expect(codeOf(() => parseSearchParams(get("?pageSize=5000"), paginationQuerySchema))).toBe("validation_error");
    expect(codeOf(() => parseSearchParams(get("?page=0"), paginationQuerySchema))).toBe("validation_error");
    expect(codeOf(() => parseSearchParams(get("?page=abc"), paginationQuerySchema))).toBe("validation_error");
  });

  it("trims search terms and keeps them optional", () => {
    expect(parseSearchParams(get("?q=%20support%20"), searchQuerySchema)).toEqual({ q: "support", page: 1, pageSize: 20 });
    expect(parseSearchParams(get(""), searchQuerySchema).q).toBeUndefined();
  });
});
