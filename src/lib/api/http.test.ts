// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { isApiError } from "@/lib/api/api-error";
import { apiFetch } from "@/lib/api/http";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(response: Response | (() => Response)) {
  const mock = vi.fn((_input: string, _init?: RequestInit) =>
    Promise.resolve(typeof response === "function" ? response() : response),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function initOf(mock: ReturnType<typeof stubFetch>): RequestInit {
  return (mock.mock.calls[0]?.[1] ?? {}) as RequestInit;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("unwraps the data envelope", async () => {
    stubFetch(jsonResponse({ data: { id: "cb_1", name: "Support" } }));
    await expect(apiFetch<{ id: string; name: string }>("/api/v1/w/acme/chatbots/cb_1")).resolves.toEqual({
      id: "cb_1",
      name: "Support",
    });
  });

  it("sends credentials and the request marker every mutating call needs", async () => {
    const mock = stubFetch(jsonResponse({ data: null }, 200));
    await apiFetch("/api/v1/w/acme/chatbots", { method: "POST", json: { name: "Support" } });

    const init = initOf(mock);
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    // The server rejects mutations without this marker (CSRF defence).
    expect(headers["X-Requested-With"]).toBe("fetch");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ name: "Support" }));
  });

  it("omits a content type when there is no body", async () => {
    const mock = stubFetch(jsonResponse({ data: [] }));
    await apiFetch("/api/v1/w/acme/chatbots");

    const headers = initOf(mock).headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(initOf(mock).body).toBeUndefined();
  });

  it("lets the caller add headers without losing the defaults", async () => {
    const mock = stubFetch(jsonResponse({ data: null }));
    await apiFetch("/api/v1/w/acme/chatbots", { headers: { "X-Trace": "abc" } });

    const headers = initOf(mock).headers as Record<string, string>;
    expect(headers["X-Trace"]).toBe("abc");
    expect(headers["X-Requested-With"]).toBe("fetch");
  });

  it("treats 204 as an empty result rather than failing to parse it", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(apiFetch<void>("/api/v1/w/acme/chatbots/cb_1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("rehydrates a server error so the UI can branch on its code", async () => {
    stubFetch(
      jsonResponse({ error: { code: "validation_error", message: "Check the fields", details: { name: ["Too short"] } } }, 422),
    );

    await expect(apiFetch("/api/v1/w/acme/chatbots", { method: "POST", json: {} })).rejects.toSatisfy((error) => {
      if (!isApiError(error)) return false;
      expect(error.code).toBe("validation_error");
      expect(error.status).toBe(422);
      expect(error.message).toBe("Check the fields");
      expect(error.details).toEqual({ name: ["Too short"] });
      return true;
    });
  });

  it("derives a code from the status when the body is not our envelope", async () => {
    stubFetch(new Response("<html>Gateway Timeout</html>", { status: 504, headers: { "content-type": "text/html" } }));

    await expect(apiFetch("/api/v1/w/acme/chatbots")).rejects.toSatisfy(
      (error) => isApiError(error) && error.code === "internal_error" && error.status === 500,
    );
  });

  it("maps the auth statuses the DAL produces", async () => {
    for (const [status, code] of [
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "conflict"],
      [429, "rate_limited"],
      [503, "unavailable"],
    ] as const) {
      stubFetch(new Response(null, { status }));
      await expect(apiFetch("/api/v1/w/acme/chatbots")).rejects.toSatisfy(
        (error) => isApiError(error) && error.code === code,
      );
      vi.unstubAllGlobals();
    }
  });
});
