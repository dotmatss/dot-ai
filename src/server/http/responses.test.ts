// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiError } from "@/lib/api/api-error";
import { DatabaseUnavailableError } from "@/server/db/client";
import { created, fail, noContent, ok, toErrorResponse } from "@/server/http/responses";

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("success responses", () => {
  it("wraps payloads in the data envelope the client unwraps", async () => {
    const response = ok({ id: "cb_1" });
    expect(response.status).toBe(200);
    await expect(body(response)).resolves.toEqual({ data: { id: "cb_1" } });

    const createdResponse = created({ id: "cb_2" });
    expect(createdResponse.status).toBe(201);
    await expect(body(createdResponse)).resolves.toEqual({ data: { id: "cb_2" } });
  });

  it("returns 204 with no body for deletions", async () => {
    const response = noContent();
    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });
});

describe("toErrorResponse", () => {
  it("maps an ApiError to its status and envelope", async () => {
    const response = toErrorResponse(ApiError.forbidden("Nope"));
    expect(response.status).toBe(403);
    await expect(body(response)).resolves.toEqual({ error: { code: "forbidden", message: "Nope" } });
  });

  it("turns a Zod failure into a 422 with per-field detail", async () => {
    const schema = z.object({ name: z.string().min(2) });
    const parsed = schema.safeParse({ name: "" });
    expect(parsed.success).toBe(false);

    const response = toErrorResponse(parsed.success ? null : parsed.error);
    expect(response.status).toBe(422);
    const payload = (await body(response)) as { error: { code: string; details: Record<string, string[]> } };
    expect(payload.error.code).toBe("validation_error");
    expect(payload.error.details.name?.length).toBeGreaterThan(0);
  });

  it("reports a database outage as 503 rather than a generic failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = toErrorResponse(new DatabaseUnavailableError("connection refused"));
    expect(response.status).toBe(503);
    await expect(body(response)).resolves.toMatchObject({ error: { code: "unavailable" } });
    spy.mockRestore();
  });

  it("hides internals behind a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = toErrorResponse(new Error("connection string postgres://user:hunter2@db/app failed"));
    expect(response.status).toBe(500);
    const payload = await body(response);
    expect(JSON.stringify(payload)).not.toContain("hunter2");
    expect(payload).toEqual({ error: { code: "internal_error", message: "Something went wrong" } });
    spy.mockRestore();
  });

  it("lets Next.js control-flow errors through instead of swallowing them", () => {
    // redirect() and notFound() work by throwing; catching them here would
    // silently turn a redirect into a 500.
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/sign-in;307;" });
    expect(() => toErrorResponse(redirectError)).toThrow(redirectError);

    const notFoundError = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(() => toErrorResponse(notFoundError)).toThrow(notFoundError);
  });
});

describe("fail", () => {
  it("serialises validation detail for the form layer", async () => {
    const response = fail(ApiError.validation({ email: ["Enter a valid email address"] }));
    expect(response.status).toBe(422);
    await expect(body(response)).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Validation failed",
        details: { email: ["Enter a valid email address"] },
      },
    });
  });
});
