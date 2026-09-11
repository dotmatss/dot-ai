// @vitest-environment node
/**
 * The guarded fetch is what keeps our SSRF controls inside the MCP SDK's
 * request path, so these tests are about refusals: what it will not do, and
 * what it will not do even when the destination tries to change after the
 * first check.
 *
 * DNS and the network are both mocked, so the assertions are about our policy
 * rather than about whatever `example.com` resolves to on the machine running
 * the suite. undici is mocked too, and its stand-in *simulates the connector*
 * by asking the dispatcher for an address the way a real connection would.
 * That is what lets these tests see which address the socket would have used.
 *
 * The third-party half of the contract - that undici's `connect.lookup` really
 * decides the destination - is exercised against a real socket in
 * `egress-pinning.contract.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup }));

/** One address the connector was told to connect to. */
interface PinnedAddress {
  address: string;
  family: number;
}

type PinnedLookup = (
  hostname: string,
  options: { all: boolean },
  callback: (error: Error | null, addresses: PinnedAddress[]) => void,
) => void;

interface FakeAgent {
  options: { connect: { lookup: PinnedLookup } };
  closed: boolean;
  close: () => Promise<void>;
}

const agents = vi.hoisted(() => [] as FakeAgent[]);
const undiciFetch = vi.hoisted(() => vi.fn());

vi.mock("undici", () => ({
  Agent: class {
    readonly options: { connect: { lookup: PinnedLookup } };
    closed = false;
    constructor(options: { connect: { lookup: PinnedLookup } }) {
      this.options = options;
      agents.push(this as unknown as FakeAgent);
    }
    close(): Promise<void> {
      this.closed = true;
      return Promise.resolve();
    }
  },
  fetch: undiciFetch,
}));

const { createGuardedFetch, EgressBlockedError, assertPublicDestination } = await import("@/server/http/egress-guard");

/** Resolves every host to a routable address unless told otherwise. */
function resolvesTo(...addresses: string[]) {
  lookup.mockResolvedValue(addresses.map((address) => entry(address)));
}

function entry(address: string): PinnedAddress {
  return { address, family: address.includes(":") ? 6 : 4 };
}

/** What the connector was handed, per request the guard made. */
let pins: Array<{ hostname: string; addresses: PinnedAddress[] }>;

type FetchInit = { dispatcher?: FakeAgent; signal?: AbortSignal } & Record<string, unknown>;

/**
 * Stands in for opening the socket: a real connection asks the dispatcher's
 * lookup where to go, so the stub does the same and records the answer.
 */
function simulateConnect(url: string | URL, init: FetchInit): void {
  const pinnedLookup = init.dispatcher?.options?.connect?.lookup;
  if (!pinnedLookup) return; // the pin was never applied; the guard must refuse
  const hostname = new URL(String(url)).hostname;
  pinnedLookup(hostname, { all: true }, (_error, addresses) => {
    pins.push({ hostname, addresses });
  });
}

/** Answers each request in turn, repeating the last response thereafter. */
function serves(...responses: Response[]) {
  let index = 0;
  undiciFetch.mockImplementation(async (url: string | URL, init: FetchInit) => {
    simulateConnect(url, init);
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response;
  });
}

/** Answers without ever consulting the dispatcher, as a client ignoring it would. */
function servesWithoutPin(response: Response) {
  undiciFetch.mockImplementation(async () => response);
}

beforeEach(() => {
  lookup.mockReset();
  undiciFetch.mockReset();
  agents.length = 0;
  pins = [];
  resolvesTo("93.184.216.34");
  serves(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
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
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it("refuses a loopback or private literal before resolving anything", async () => {
    for (const url of ["https://127.0.0.1/mcp", "https://10.0.0.1/mcp", "https://[::1]/mcp", "https://169.254.169.254/"]) {
      await expect(guarded()(url), url).rejects.toThrow(EgressBlockedError);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses a URL carrying credentials", async () => {
    await expect(guarded()("https://user:pass@mcp.example.com/mcp")).rejects.toThrow(EgressBlockedError);
  });

  it("refuses a non-standard port, which is the usual way to tunnel inward", async () => {
    await expect(guarded()("https://mcp.example.com:6379/mcp")).rejects.toThrow(EgressBlockedError);
  });

  it("refuses a public name that resolves into private space", async () => {
    resolvesTo("10.1.2.3");
    await expect(guarded()("https://mcp.example.com/mcp")).rejects.toThrow(/private address/i);
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it("refuses a name that resolves to one public and one private address", async () => {
    // Refusing only on the first address would let the choice of which to
    // connect to decide whether the guard held.
    resolvesTo("93.184.216.34", "192.168.1.1");
    await expect(guarded()("https://mcp.example.com/mcp")).rejects.toThrow(/private address/i);
  });

  it("refuses a name that does not resolve", async () => {
    lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(guarded()("https://nope.example.com/mcp")).rejects.toThrow(/could not resolve/i);
  });

  it("checks every address on its own and reports the ones that passed", async () => {
    resolvesTo("8.8.8.8");
    expect(await assertPublicDestination("dns.example.com")).toEqual({
      ok: true,
      addresses: [{ address: "8.8.8.8", family: 4 }],
    });
    resolvesTo("172.16.0.9");
    expect((await assertPublicDestination("internal.example.com")).ok).toBe(false);
  });
});

describe("pinning the socket to the validated address", () => {
  it("connects to the address it checked", async () => {
    await guarded()("https://mcp.example.com/mcp");
    expect(pins).toEqual([{ hostname: "mcp.example.com", addresses: [{ address: "93.184.216.34", family: 4 }] }]);
  });

  it("still sends the original hostname, rather than rewriting the URL to an IP", async () => {
    // Putting the address in the URL would break TLS verification, virtual
    // hosting and the Host header all at once.
    await guarded()("https://mcp.example.com/mcp");
    expect(String(undiciFetch.mock.calls[0]?.[0])).toBe("https://mcp.example.com/mcp");
  });

  it("does not connect to an address a second resolution returns", async () => {
    // The regression this whole mechanism exists for. The first answer is
    // public and is what we validated; a second answer is private. A client
    // that resolved the name again at connect time would use the private one.
    lookup.mockResolvedValueOnce([entry("93.184.216.34")]).mockResolvedValueOnce([entry("169.254.169.254")]);

    const response = await guarded()("https://rebind.example.com/mcp");

    expect(response.status).toBe(200);
    expect(pins).toEqual([{ hostname: "rebind.example.com", addresses: [{ address: "93.184.216.34", family: 4 }] }]);
    // Resolved once, for the check. There is no second resolution to poison.
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(pins)).not.toContain("169.254.169.254");
  });

  it("passes an IPv6 address with its family, so IPv6 destinations still work", async () => {
    resolvesTo("2606:2800:220:1:248:1893:25c8:1946");
    await guarded()("https://v6.example.com/mcp");
    expect(pins[0]?.addresses).toEqual([{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }]);
  });

  it("offers every validated address, so dual-stack and failover still work", async () => {
    resolvesTo("2606:2800:220:1:248:1893:25c8:1946", "93.184.216.34");
    await guarded()("https://dual.example.com/mcp");
    expect(pins[0]?.addresses).toEqual([
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it("refuses a response that came back without using the pin", async () => {
    // If the dispatcher were ever ignored, the connection went somewhere we
    // never validated, so the response is refused rather than returned.
    servesWithoutPin(new Response("{}", { status: 200 }));
    await expect(guarded()("https://mcp.example.com/mcp")).rejects.toThrow(/validated address/i);
  });

  it("uses a fresh dispatcher per hop and closes the one it has finished with", async () => {
    serves(new Response(null, { status: 302, headers: { location: "https://other.example.com/mcp" } }), new Response("{}"));

    await guarded()("https://mcp.example.com/mcp");

    expect(agents).toHaveLength(2);
    expect(agents[0]?.closed).toBe(true);
  });

  it("keeps the dispatcher open until the body has been read, then closes it", async () => {
    const response = await guarded()("https://mcp.example.com/mcp");
    expect(agents[0]?.closed).toBe(false);
    await response.text();
    expect(agents[0]?.closed).toBe(true);
  });

  it("closes the dispatcher when the request itself fails", async () => {
    undiciFetch.mockRejectedValue(new Error("socket hang up"));
    await expect(guarded()("https://mcp.example.com/mcp")).rejects.toThrow(/socket hang up/);
    expect(agents[0]?.closed).toBe(true);
  });
});

describe("requests that are allowed through", () => {
  it("sends the request with manual redirects and no caching", async () => {
    const response = await guarded()("https://mcp.example.com/mcp", { method: "POST", body: "{}" });

    expect(response.status).toBe(200);
    const init = undiciFetch.mock.calls[0]?.[1] as FetchInit;
    expect(init).toMatchObject({ method: "POST", redirect: "manual", cache: "no-store" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.dispatcher).toBeDefined();
  });

  it("returns the body, because the MCP client has to read it", async () => {
    serves(new Response(JSON.stringify({ tools: [] }), { headers: { "content-type": "application/json" } }));
    const response = await guarded()("https://mcp.example.com/mcp");
    await expect(response.json()).resolves.toEqual({ tools: [] });
  });

  it("returns a platform Response, which is what libraries check for", async () => {
    // undici's own classes are not the global ones, and the MCP SDK asserts
    // `instanceof Response`.
    const response = await guarded()("https://mcp.example.com/mcp");
    expect(response).toBeInstanceOf(Response);
    expect(response.headers).toBeInstanceOf(Headers);
  });

  it("preserves repeated headers such as set-cookie", async () => {
    const headers = new Headers();
    headers.append("set-cookie", "a=1");
    headers.append("set-cookie", "b=2");
    serves(new Response("{}", { headers }));

    const response = await guarded()("https://mcp.example.com/mcp");
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });
});

describe("redirects", () => {
  function redirectTo(location: string) {
    return new Response(null, { status: 302, headers: { location } });
  }

  it("follows a redirect to another public destination", async () => {
    serves(redirectTo("https://other.example.com/mcp"), new Response("{}", { status: 200 }));

    const response = await guarded()("https://mcp.example.com/mcp");
    expect(response.status).toBe(200);
    expect(undiciFetch).toHaveBeenCalledTimes(2);
  });

  it("re-checks the destination on the redirect, blocking an open redirect inward", async () => {
    // The classic route to the cloud metadata endpoint: a legitimate host that
    // redirects. The first check passing must not grant the second hop.
    serves(redirectTo("https://169.254.169.254/latest/meta-data/"));

    await expect(guarded()("https://mcp.example.com/mcp")).rejects.toThrow(EgressBlockedError);
    expect(undiciFetch).toHaveBeenCalledTimes(1);
  });

  it("re-resolves DNS on the redirect and pins the new address", async () => {
    serves(redirectTo("https://second.example.com/mcp"));
    lookup.mockResolvedValueOnce([entry("93.184.216.34")]).mockResolvedValueOnce([entry("10.0.0.5")]);

    await expect(guarded()("https://mcp.example.com/mcp")).rejects.toThrow(/private address/i);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("refuses a redirect chain longer than the limit", async () => {
    serves(redirectTo("https://loop.example.com/mcp"));
    await expect(guarded({ maxRedirects: 2 })("https://mcp.example.com/mcp")).rejects.toThrow(/too many times/i);
  });

  it("refuses a redirect with no destination", async () => {
    serves(new Response(null, { status: 302 }));
    await expect(guarded()("https://mcp.example.com/mcp")).rejects.toThrow(/without a destination/i);
  });

  it("resolves a relative redirect against the current hop", async () => {
    serves(redirectTo("/elsewhere"), new Response("{}", { status: 200 }));
    await guarded()("https://mcp.example.com/mcp");
    expect(String(undiciFetch.mock.calls[1]?.[0])).toBe("https://mcp.example.com/elsewhere");
  });

  it("reports where it ended up, so callers can record the final URL", async () => {
    serves(redirectTo("https://other.example.com/moved"), new Response("{}", { status: 200 }));
    const response = await guarded()("https://mcp.example.com/mcp");
    expect(response.url).toBe("https://other.example.com/moved");
  });
});

describe("response size", () => {
  it("refuses a body whose declared length is over the cap", async () => {
    serves(new Response("x".repeat(10), { headers: { "content-length": "5000000" } }));
    await expect(guarded({ maxResponseBytes: 1_000 })("https://mcp.example.com/mcp")).rejects.toThrow(/larger than/i);
  });

  it("refuses a body that exceeds the cap while streaming", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2_000));
        controller.close();
      },
    });
    serves(new Response(body, { headers: { "content-type": "application/json" } }));

    const response = await guarded({ maxResponseBytes: 1_000 })("https://mcp.example.com/mcp");
    await expect(response.text()).rejects.toThrow();
  });

  it("does not count bytes on an event stream, which stays open by design", async () => {
    // The wall-clock budget bounds an SSE response; counting its total would
    // kill a legitimate long-lived stream.
    serves(new Response("data: {}\n\n", { headers: { "content-type": "text/event-stream" } }));
    const response = await guarded({ maxResponseBytes: 1 })("https://mcp.example.com/mcp");
    await expect(response.text()).resolves.toContain("data:");
  });
});

describe("cancellation", () => {
  it("aborts when the caller's own signal aborts", async () => {
    const controller = new AbortController();
    undiciFetch.mockImplementation((_url: string | URL, init: FetchInit) => {
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
