// @vitest-environment node
/**
 * The egress guard's socket pinning rests on a contract with a third-party
 * library: undici's `Agent({ connect: { lookup } })` decides where the socket
 * actually goes, and the request still carries the original hostname.
 *
 * Every other test of the guard mocks undici, which means an undici upgrade
 * could change that behaviour and leave the suite green while the protection
 * silently stopped working. So this file uses the real library against a real
 * socket and a real HTTP server. It asserts the two properties the guard
 * depends on, and nothing about our own policy.
 *
 * IPv6 here is loopback only. That proves the address family reaches the
 * socket; whether outbound public IPv6 works at all is a property of the
 * deployment network and has to be verified there.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

import { Agent, fetch as undiciFetch } from "undici";
import { afterAll, describe, expect, it } from "vitest";

/** Every request this server received, by Host header. */
const hits: string[] = [];
const servers: http.Server[] = [];

const handler: http.RequestListener = (request, response) => {
  hits.push(request.headers.host ?? "");
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ host: request.headers.host, remote: request.socket.remoteAddress }));
};

async function listen(host: string): Promise<number | null> {
  const server = http.createServer(handler);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, resolve);
    });
  } catch {
    return null; // the family is not available on this machine
  }
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

const v4Port = await listen("127.0.0.1");
const v6Port = await listen("::1");

afterAll(() => {
  for (const server of servers) server.close();
});

interface Asked {
  hostname: string;
  all: boolean | undefined;
}

function pinnedAgent(addresses: Array<{ address: string; family: number }>) {
  const asked: Asked[] = [];
  const agent = new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        asked.push({ hostname, all: options.all });
        callback(null, addresses);
      },
    },
  });
  return { agent, asked };
}

interface Echo {
  host: string;
  remote: string;
}

// A hostname in a reserved TLD that must never resolve, so reaching the server
// can only be the pin's doing.
const NAME = "pinned.invalid";

describe("undici honours a pinned address", () => {
  it("connects to the pinned address for a hostname that does not resolve", async () => {
    expect(v4Port, "IPv4 loopback is required to run this suite").not.toBeNull();
    const { agent, asked } = pinnedAgent([{ address: "127.0.0.1", family: 4 }]);
    try {
      const response = await undiciFetch(`http://${NAME}:${v4Port}/mcp`, { dispatcher: agent, redirect: "manual" });
      const body = (await response.json()) as Echo;

      expect(response.status).toBe(200);
      expect(body.remote).toBe("127.0.0.1");
      // The URL keeps the hostname: no rewriting to an IP, so TLS verification
      // and virtual hosting still work.
      expect(body.host).toBe(`${NAME}:${v4Port}`);
      // The guard's lookup replies with an array because the connector asks
      // with `all: true`. The scalar form throws "Invalid IP address".
      expect(asked).toEqual([{ hostname: NAME, all: true }]);
    } finally {
      await agent.close();
    }
  });

  it("cannot reach that server without the pin, which is what proves the pin did the work", async () => {
    const before = hits.length;
    try {
      // No dispatcher: undici resolves the name itself and gets nowhere. The
      // signal is a guard against a resolver that hijacks NXDOMAIN rather than
      // part of the assertion.
      await undiciFetch(`http://${NAME}:${v4Port}/mcp`, { signal: AbortSignal.timeout(3_000) });
    } catch {
      // expected
    }
    expect(hits.length, "an unpinned request must not have reached the server").toBe(before);
  });

  it.skipIf(v6Port === null)("carries an IPv6 address and its family to the socket", async () => {
    const { agent, asked } = pinnedAgent([{ address: "::1", family: 6 }]);
    try {
      const response = await undiciFetch(`http://${NAME}:${v6Port}/mcp`, { dispatcher: agent, redirect: "manual" });
      const body = (await response.json()) as Echo;

      expect(response.status).toBe(200);
      expect(body.remote).toBe("::1");
      expect(body.host).toBe(`${NAME}:${v6Port}`);
      expect(asked[0]?.all).toBe(true);
    } finally {
      await agent.close();
    }
  });

  it("returns a response whose body is a platform stream the guard can re-wrap", async () => {
    const { agent } = pinnedAgent([{ address: "127.0.0.1", family: 4 }]);
    try {
      const response = await undiciFetch(`http://${NAME}:${v4Port}/mcp`, { dispatcher: agent, redirect: "manual" });

      // undici's Response is not the global one, which is why the guard
      // re-wraps it; its body stream, however, is a platform stream.
      expect(response instanceof globalThis.Response).toBe(false);
      expect(response.body).toBeInstanceOf(ReadableStream);

      // The cast mirrors the guard's: undici types the body loosely, and the
      // assertion above is what establishes what it really is.
      const body = response.body as ReadableStream<Uint8Array>;
      const wrapped = new globalThis.Response(body, { status: response.status, headers: [...response.headers] });
      expect(wrapped).toBeInstanceOf(globalThis.Response);
      await expect(wrapped.json()).resolves.toMatchObject({ remote: "127.0.0.1" });
    } finally {
      await agent.close();
    }
  });
});
