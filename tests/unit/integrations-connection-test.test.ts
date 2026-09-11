// @vitest-environment node
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DNS and the network are stubbed so these assertions are about the guards, not
// about the machine's network. Every case below would otherwise leave the
// process. undici is mocked at the module level because delivery now goes
// through the shared egress guard, which dispatches through undici so the
// socket can be pinned to the address that was checked.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

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
  close: () => Promise<void>;
}

const undiciFetch = vi.hoisted(() => vi.fn());

vi.mock("undici", () => ({
  Agent: class {
    readonly options: { connect: { lookup: PinnedLookup } };
    constructor(options: { connect: { lookup: PinnedLookup } }) {
      this.options = options;
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
  },
  fetch: undiciFetch,
}));

const { postTestPayload, signPayload } = await import("@/features/integrations/server/connection-test");

const mockedLookup = vi.mocked(lookup);

type FetchInit = { dispatcher?: FakeAgent } & Record<string, unknown>;

/** What the socket would have connected to, per request. */
let pins: PinnedAddress[][];

function resolvesTo(address: string) {
  mockedLookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }] as never);
}

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

/** Stands in for opening the socket: a real connection asks the dispatcher where to go. */
function serves(...responses: Response[]) {
  let index = 0;
  undiciFetch.mockImplementation(async (url: string | URL, init: FetchInit) => {
    const pinnedLookup = init.dispatcher?.options?.connect?.lookup;
    if (pinnedLookup) {
      pinnedLookup(new URL(String(url)).hostname, { all: true }, (_error, addresses) => {
        pins.push(addresses);
      });
    }
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response;
  });
}

beforeEach(() => {
  mockedLookup.mockReset();
  undiciFetch.mockReset();
  pins = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postTestPayload destination policy", () => {
  it("refuses a private destination before touching the network", async () => {
    for (const url of ["http://127.0.0.1/hook", "http://169.254.169.254/", "http://10.0.0.5/hook", "file:///etc/passwd"]) {
      const result = await postTestPayload({ url, body: {} });
      expect(result.ok, url).toBe(false);
    }
    expect(undiciFetch).not.toHaveBeenCalled();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("refuses a public name that resolves to a private address", async () => {
    // The DNS rebinding case: the literal passes, the answer does not.
    resolvesTo("169.254.169.254");
    const result = await postTestPayload({ url: "https://metadata.example.com/", body: {} });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("private address");
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it("refuses a host that does not resolve", async () => {
    mockedLookup.mockRejectedValue(new Error("ENOTFOUND"));
    const result = await postTestPayload({ url: "https://nope.example.com/", body: {} });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Could not resolve");
  });

  it("delivers to the address it validated, not to a second resolution", async () => {
    // The same protection the MCP client gets: this path is customer-controlled
    // too, so it must not be left behind with the old window open.
    mockedLookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never)
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }] as never);
    serves(new Response(null, { status: 200 }));

    const result = await postTestPayload({ url: "https://hooks.example.com/x", body: {} });

    expect(result.ok).toBe(true);
    expect(pins).toEqual([[{ address: "93.184.216.34", family: 4 }]]);
    expect(mockedLookup).toHaveBeenCalledTimes(1);
  });

  it("reports success for a 2xx and failure for an error status", async () => {
    resolvesTo("93.184.216.34");
    serves(new Response(null, { status: 204 }));
    await expect(postTestPayload({ url: "https://hooks.example.com/x", body: { a: 1 } })).resolves.toMatchObject({ ok: true });

    serves(new Response("nope", { status: 500 }));
    const failure = await postTestPayload({ url: "https://hooks.example.com/x", body: {} });
    expect(failure.ok).toBe(false);
    expect(failure.message).toContain("500");
    // The response body is never echoed back to the operator.
    expect(failure.message).not.toContain("nope");
  });

  it("re-validates every redirect hop, which is how an open redirect is stopped", async () => {
    resolvesTo("93.184.216.34");
    serves(redirectTo("http://169.254.169.254/latest/meta-data/"));
    const result = await postTestPayload({ url: "https://hooks.example.com/x", body: {} });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("cannot be called");
  });

  it("follows a redirect to a public destination and re-resolves it", async () => {
    resolvesTo("93.184.216.34");
    serves(redirectTo("https://hooks.example.org/moved"), new Response(null, { status: 200 }));
    const result = await postTestPayload({ url: "https://hooks.example.com/x", body: {} });
    expect(result.ok).toBe(true);
    // Two hops, two DNS checks: the second host is never taken on trust, and
    // each hop gets its own pin.
    expect(mockedLookup).toHaveBeenCalledTimes(2);
    expect(pins).toHaveLength(2);
  });

  it("gives up rather than following redirects forever", async () => {
    resolvesTo("93.184.216.34");
    serves(redirectTo("https://hooks.example.com/next"));
    const result = await postTestPayload({ url: "https://hooks.example.com/x", body: {} });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("redirects too many times");
  });

  it("rejects a redirect with no destination", async () => {
    resolvesTo("93.184.216.34");
    serves(new Response(null, { status: 302 }));
    const result = await postTestPayload({ url: "https://hooks.example.com/x", body: {} });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("without a destination");
  });

  it("names the display label instead of the host when the URL is itself a secret", async () => {
    resolvesTo("93.184.216.34");
    serves(new Response(null, { status: 403 }));
    const result = await postTestPayload({
      url: "https://hooks.slack.com/services/T000/B000/xoxb-secret-path",
      body: {},
      displayName: "Slack",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Slack");
    expect(result.message).not.toContain("xoxb-secret-path");
  });

  it("signs the payload only when a signing secret is configured", async () => {
    resolvesTo("93.184.216.34");
    serves(new Response(null, { status: 200 }));

    await postTestPayload({ url: "https://hooks.example.com/x", body: { a: 1 } });
    const unsigned = undiciFetch.mock.calls[0]?.[1] as FetchInit;
    expect((unsigned?.headers as Record<string, string>)["X-Dot-Signature"]).toBeUndefined();

    await postTestPayload({ url: "https://hooks.example.com/x", body: { a: 1 }, signingSecret: "whsec" });
    const signed = undiciFetch.mock.calls[1]?.[1] as FetchInit;
    const header = (signed?.headers as Record<string, string>)["X-Dot-Signature"];
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    // The secret itself must never travel in a header.
    expect(header).not.toContain("whsec");
  });
});

describe("signPayload", () => {
  it("is an HMAC-SHA256 over `timestamp.body`, so receivers can verify replay windows", () => {
    expect(signPayload('{"a":1}', "secret", 1_700_000_000)).toBe(
      createHmac("sha256", "secret").update('1700000000.{"a":1}').digest("hex"),
    );
  });

  it("changes when the body, the timestamp or the secret changes", () => {
    const base = signPayload("{}", "secret", 1);
    expect(signPayload("{ }", "secret", 1)).not.toBe(base);
    expect(signPayload("{}", "secret", 2)).not.toBe(base);
    expect(signPayload("{}", "other", 1)).not.toBe(base);
  });
});
