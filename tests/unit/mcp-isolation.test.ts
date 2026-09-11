// @vitest-environment node
/**
 * Proves the two structural promises the MCP gate was approved on.
 *
 * 1. **No stdio, ever.** `stdio` means launching a subprocess from
 *    customer-supplied configuration, which on shared infrastructure is remote
 *    code execution as our service account. The SDK ships it as a separate
 *    subpath export, so the guarantee is simply that we never import it — and
 *    a guarantee nothing checks is a guarantee that lasts until the first
 *    well-meaning pull request.
 *
 * 2. **Every outbound request goes through the egress guard.** The SDK's
 *    transport reaches the network only via the `fetch` we hand it. If a
 *    future edit dropped that option, the SSRF controls would silently stop
 *    applying and nothing else would fail.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const absolute = path.join(root, dir);
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const full = path.join(absolute, entry);
    const relative = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(relative));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(relative);
  }
  return out;
}

function read(file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

const MCP_FILES = sourceFiles("src/features/mcp");

describe("MCP transport isolation", () => {
  it("has source files to check", () => {
    // Guards the guard: an empty list would make every assertion below pass.
    expect(MCP_FILES.length).toBeGreaterThan(4);
  });

  it("never imports the SDK's stdio transport", () => {
    const offenders = MCP_FILES.filter((file) => /@modelcontextprotocol\/client\/stdio/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("never names a stdio transport or spawns a process anywhere in the feature", () => {
    const forbidden = [
      { pattern: /StdioClientTransport/, why: "the stdio transport" },
      { pattern: /child_process/, why: "process spawning" },
      { pattern: /\bspawn\s*\(/, why: "process spawning" },
      { pattern: /cross-spawn/, why: "process spawning" },
    ];
    const offenders: string[] = [];
    for (const file of MCP_FILES) {
      // Comments explain why stdio is excluded, so only real code is inspected.
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const { pattern, why } of forbidden) {
        if (pattern.test(code)) offenders.push(`${file} references ${why}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares http as the only transport", () => {
    const types = read("src/features/mcp/types.ts");
    expect(types).toMatch(/MCP_TRANSPORTS = \["http"\] as const/);
    expect(types).not.toMatch(/"stdio"/);
  });
});

describe("MCP egress isolation", () => {
  const client = read("src/features/mcp/server/mcp-client.ts");

  it("is the only file in the feature that imports the MCP SDK", () => {
    const importers = MCP_FILES.filter((file) => /from "@modelcontextprotocol\//.test(read(file)));
    expect(importers).toEqual(["src/features/mcp/server/mcp-client.ts"]);
  });

  it("hands the transport our guarded fetch", () => {
    // The transport documents `fetch` as being used for all network requests,
    // so this line is what keeps the SSRF controls inside the request path.
    expect(client).toMatch(/fetch:\s*createGuardedFetch\(/);
    expect(client).toMatch(/from "@\/server\/http\/egress-guard"/);
  });

  it("never calls global fetch directly", () => {
    const code = client.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/(^|[^.\w])fetch\s*\(/);
  });

  it("requires https by default in the guard", () => {
    expect(read("src/server/http/egress-guard.ts")).toMatch(/requireHttps:\s*true/);
  });

  it("re-checks the destination on every redirect hop", () => {
    const guard = read("src/server/http/egress-guard.ts");
    // The loop, the manual redirect mode and the per-hop DNS check together are
    // what stop an open redirect reaching 169.254.169.254.
    expect(guard).toMatch(/for \(let hop = 0/);
    expect(guard).toMatch(/redirect: "manual"/);
    expect(guard).toMatch(/await assertPublicDestination\(/);
  });

  it("pins the socket to the address it validated", () => {
    const guard = read("src/server/http/egress-guard.ts");
    // Validating a name and then handing the name to the HTTP client leaves the
    // connection free to land on a different address. The dispatcher is what
    // fixes it, and it must be built per request rather than shared.
    expect(guard).toMatch(/dispatcher:\s*pin\.agent/);
    expect(guard).toMatch(/const pin = pinTo\(destination\.addresses\)/);
    expect(guard).toMatch(/new Agent\(\{ connect: \{ lookup: pinnedLookup \} \}\)/);
  });

  it("keeps one implementation of the private-address check", () => {
    // Both of the other customer-controlled outbound paths used to carry their
    // own copy of the DNS check. They now delegate the whole socket path.
    for (const file of [
      "src/features/integrations/server/connection-test.ts",
      "src/features/knowledge/server/url-ingest.ts",
    ]) {
      const source = read(file);
      expect(source, `${file} must go through the shared guard`).toMatch(/createGuardedFetch/);
      expect(source, `${file} must not resolve DNS itself`).not.toMatch(/dns\/promises/);
      expect(source, `${file} must not classify addresses itself`).not.toMatch(/isBlockedIpAddress/);
    }
  });

  it("lets exactly one module resolve, classify and dispatch", () => {
    // A second copy of any of these is a second place the protection can be
    // missing, so the count is the assertion.
    const all = sourceFiles("src");
    expect(all.length).toBeGreaterThan(50);
    const importing = (pattern: RegExp) => all.filter((file) => pattern.test(read(file)));

    expect(importing(/from "node:dns/)).toEqual(["src/server/http/egress-guard.ts"]);
    expect(importing(/from "undici"/)).toEqual(["src/server/http/egress-guard.ts"]);
    expect(importing(/isBlockedIpAddress/)).toEqual([
      "src/features/knowledge/url-safety.ts",
      "src/server/http/egress-guard.ts",
    ]);
    // Replacing the process-wide dispatcher would silently re-route every
    // request in the application, including ones that never asked for a pin.
    expect(importing(/setGlobalDispatcher/)).toEqual([]);
  });
});

describe("MCP credential handling", () => {
  it("never reads a credential into client-side state or the environment", () => {
    for (const file of MCP_FILES) {
      const source = read(file);
      expect(source, `${file} must not read NEXT_PUBLIC_`).not.toMatch(/NEXT_PUBLIC_/);
      expect(source, `${file} must not read process.env`).not.toMatch(/process\.env/);
    }
  });

  it("keeps the credential out of any error message the client produces", () => {
    const code = read("src/features/mcp/server/mcp-client.ts");
    // `classify` builds every message from fixed strings; the credential and
    // the endpoint URL (which can itself be a secret) never appear.
    const classify = code.slice(code.indexOf("function classify"), code.indexOf("function authFor"));
    expect(classify).not.toMatch(/config\.credential|endpointUrl/);
  });

  it("marks every server module as server-only", () => {
    for (const file of MCP_FILES.filter((candidate) => candidate.includes("/server/"))) {
      expect(read(file), file).toMatch(/^import "server-only";/m);
    }
  });
});
