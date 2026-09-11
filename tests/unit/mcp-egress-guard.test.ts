// @vitest-environment node
/**
 * The guarded fetch is what keeps our SSRF controls inside the MCP SDK's
 * request path, so these tests are about refusals: what it will not do, and
 * what it will not do even when a redirect tries to move the destination.
 *
 * DNS and the network are both mocked, so the assertions are about our policy
 * rather than about whatever `example.com` resolves to on the machine running
 * the suite.
 *
 * ## What is deliberately NOT tested here any more
 *
 * Socket pinning. Phase 2a pinned each connection to the address that had just
 * been validated, and these tests asserted the address handed to the
 * dispatcher. That was removed when the deployment target became Cloudflare
 * Workers, which provides no way to fix a connection to a chosen address. The
 * time-of-check-to-time-of-use window between resolving a name and connecting
 * to it is therefore open, by decision, and is recorded in
 * `docs/deployment.md`. Tests for a mechanism that is no longer there would
 * assert nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolve4 = vi.hoisted(() => vi.fn());
const resolve6 = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ resolve4, resolve6 }));

const { createGuardedFetch, EgressBlockedError, assertPublicDestination } = await import("@/server/http/egress-guard");

/** Resolves every host to a routable IPv4 address unless told otherwise. */
function resolvesTo(v4: string[], v6: string[] = []) {
  resolve4.mockResolvedValue(v4);
  resolve6.mockResolvedValue(v6);
}

/** A host with no records of either family, as the resolver reports it. */
function resolvesToNothing() {
  resolve4.mockRejectedValue(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
  resolve6.mockRejectedValue(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resolve4.mockReset();
  resolve6.mockReset();
  resolvesTo(["93.184.216.34"]);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function guarded(options: Partial<Parameters<typeof createGuardedFetch>[0]> = {}) {
  return createGuardedFetch({ timeoutMs: 5_000, ...options });
}

describe("destination policy", () => {
  it("refuses a plain http endpoint", async () => {
    await expect(guarded()("http://mcp.example.com/mcp")).rejects.toThrow(EgressBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a loopback or private literal before resolving anything", async () => {
    for (const url of ["https://127.0.0.1/mcp", "https://10.0.0.1/mcp", "https://[::1]/mcp", "https://169.254.169.254/"]) {
      await expect(guarded()(url), url).rejects.toThrow(EgressBlockedError);
    }
    expect(resolve4).not.toHaveBeenCalled();
    expect(resolve6).not.toHaveBeenCalled();
  });

  it("refuses a URL carrying credentials", async () => {
    await expect(guarded()("https://user:pass@mcp.example.com/mcp")).rejects.toThrow(EgressBlockedError);
  });

  it("refuses a non-standard port, which is the usual way to tunnel inward", async () => {
    await expect(guarded()("https://mcp.example.com:6379/mcp")).rejects.toThrow(EgressBlockedError);
  });

  it("refuses a public name that resolves into private space", async () => {
    resolvesTo(["10.1.2.3"]);
    await expect(guarded()("https://mcp.example.com/mcp")).rejects.toThrow(/private address/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a name that resolves to one public and one private address", async () => {
    // Refusing only on the first address would let the choice of which to
    // connect to decide whether the guard held.
    resolvesTo(["93.184.216.34", "192.168.1.1"]);
    await expect(guarded()("https://mcp.example.com/mcp")).rejects.toThrow(/private address/i);
  });

  it("checks both address families, not just the one it looked at first", async () => {
    // A public A record and a private AAAA record is the same trick played
    // across families, and either answer could be the one connected to.
    resolvesTo(["93.184.216.34"], ["fd00::1"]);
    await expect(guarded()("https://dual.example.com/mcp")).rejects.toThrow(/private address/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a name with only IPv6 records", async () => {
    resolvesTo([], ["2606:2800:220:1:248:1893:25c8:1946"]);
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(guarded()("https://v6.example.com/mcp")).resolves.toMatchObject({ status: 200 });
  });

  it("refuses a name that does not resolve in either family", async () => {
    resolvesToNothing();
    await expect(guarded()("https://nope.example.com/mcp")).rejects.toThrow(/could not resolve/i);
  });

  it("uses record queries rather than the system resolver", async () => {
    // `dns.lookup` throws "Not implemented" on the Workers runtime, so this
    // path must stay on resolve4/resolve6. See docs/deployment.md.
    resolvesTo(["8.8.8.8"]);
    expect(await assertPublicDestination("dns.example.com")).toEqual({ ok: true });
    expect(resolve4).toHaveBeenCalledWith("dns.example.com");
    expect(resolve6).toHaveBeenCalledWith("dns.example.com");
  });

  it("strips the brackets from an IPv6 hostname before resolving", async () => {
    resolvesTo(["93.184.216.34"]);
    await assertPublicDestination("[2606:2800::1]");
    expect(resolve4).toHaveBeenCalledWith("2606:2800::1");
  });
});

describe("requests that are allowed through", () => {
  it("sends the request with manual redirects and no caching", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));

    const response = await guarded()("https://mcp.example.com/mcp", { method: "POST", body: "{}" });

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: "POST", redirect: "manual", cache: "no-store" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the body, because the MCP client has to read it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tools: [] }), { headers: { "content-type": "application/json" } }));
    const response = await guarded()("https://mcp.example.com/mcp");
    await expect(response.json()).resolves.toEqual({ tools: [] });
  });

  it("keeps the hostname in the URL rather than substituting an address", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await guarded()("https://mcp.example.com/mcp");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://mcp.example.com/mcp");
  });
});

describe("redirects", () => {
  function redirectTo(location: string) {
    return new Response(null, { status: 302, headers: { location } });
  }

  it("follows a redirect to another public destination", async () => {
    fetchMock
      .mockResolvedValueOnce(redirectTo("https://other.example.com/mcp"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const response = await guarded()("https://mcp.example.com/mcp");
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-checks the destination on the redirect, blocking an open redirect inward", async () => {
    // The classic route to the cloud metadata endpoint: a legitimate host that
    // redirects. The first check passing must not grant the second hop.
    fetchMock.mockResolvedValueOnce(redirectTo("https://169.254.169.254/latest/meta-data/"));

    await expect(guarded()("https://mcp.example.com/mcp")).rejects.toThrow(EgressBlockedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-resolves DNS on the redirect", async () => {
    fetchMock.mockResolvedValueOnce(redirectTo("https://second.example.com/mcp"));
    resolve4.mockResolvedValueOnce(["93.184.216.34"]).mockResolvedValueOnce(["10.0.0.5"]);
    resolve6.mockResolvedValue([]);

    await expect(guarded()("https://mcp.example.com/mcp")).rejects.toThrow(/private address/i);
    expect(resolve4).toHaveBeenCalledTimes(2);
  });

  it("refuses a redirect chain longer than the limit", async () => {
    fetchMock.mockResolvedValue(redirectTo("https://loop.example.com/mcp"));
    await expect(guarded({ maxRedirects: 2 })("https://mcp.example.com/mcp")).rejects.toThrow(/too many times/i);
  });

  it("refuses a redirect with no destination", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    await expect(guarded()("https://mcp.example.com/mcp")).rejects.toThrow(/without a destination/i);
  });

  it("resolves a relative redirect against the current hop", async () => {
    fetchMock.mockResolvedValueOnce(redirectTo("/elsewhere")).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await guarded()("https://mcp.example.com/mcp");
    expect(String(fetchMock.mock.calls[1]![0])).toBe("https://mcp.example.com/elsewhere");
  });

  it("reports where it ended up, so callers can record the final URL", async () => {
    fetchMock
      .mockResolvedValueOnce(redirectTo("https://other.example.com/moved"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const response = await guarded()("https://mcp.example.com/mcp");
    expect(response.url).toBe("https://other.example.com/moved");
  });
});

describe("response size", () => {
  it("refuses a body whose declared length is over the cap", async () => {
    fetchMock.mockResolvedValue(new Response("x".repeat(10), { headers: { "content-length": "5000000" } }));
    await expect(guarded({ maxResponseBytes: 1_000 })("https://mcp.example.com/mcp")).rejects.toThrow(/larger than/i);
  });

  it("refuses a body that exceeds the cap while streaming", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2_000));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { headers: { "content-type": "application/json" } }));

    const response = await guarded({ maxResponseBytes: 1_000 })("https://mcp.example.com/mcp");
    await expect(response.text()).rejects.toThrow();
  });

  it("does not count bytes on an event stream, which stays open by design", async () => {
    // The wall-clock budget bounds an SSE response; counting its total would
    // kill a legitimate long-lived stream.
    fetchMock.mockResolvedValue(new Response("data: {}\n\n", { headers: { "content-type": "text/event-stream" } }));
    const response = await guarded({ maxResponseBytes: 1 })("https://mcp.example.com/mcp");
    await expect(response.text()).resolves.toContain("data:");
  });

  it("reads an uncapped body whole, for a caller that discards it", async () => {
    fetchMock.mockResolvedValue(new Response("anything", { headers: { "content-length": "999999999" } }));
    const response = await guarded({ maxResponseBytes: Number.POSITIVE_INFINITY })("https://mcp.example.com/mcp");
    await expect(response.text()).resolves.toBe("anything");
  });
});

describe("cancellation", () => {
  it("aborts when the caller's own signal aborts", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url: unknown, init: RequestInit) => {
      const abort = () => new DOMException("Aborted", "AbortError");
      // The abort can already have happened: the guard registers its listener
      // before the DNS check, so a caller who aborts immediately does so
      // before fetch is ever reached. A mock that only waits for a future
      // event would hang here rather than fail.
      if (init.signal?.aborted) return Promise.reject(abort());
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(abort()), { once: true });
      });
    });

    const pending = guarded()("https://mcp.example.com/mcp", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/i);
  });
});
