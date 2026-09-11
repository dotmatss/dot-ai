// @vitest-environment node
/**
 * Proves the public demo cannot reach customer data.
 *
 * The demo is unauthenticated and anonymous, so the usual defences - a
 * session, a workspace context, Row Level Security - do not apply to it. What
 * keeps it safe is that it has nothing tenant-scoped to reach in the first
 * place. That is a property of its import graph, and a property is only real
 * if something checks it: one careless `import { findChatbotById }` would
 * quietly turn a marketing widget into a tenant-data endpoint.
 *
 * So this walks every module reachable from the demo route and the demo
 * service, and fails if any of them can touch the database, a repository, a
 * credential or an authorization context.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..");
const ENTRY_POINTS = [
  "src/app/api/public/demo/chat/route.ts",
  "src/features/public-chatbot/server/demo-chat.ts",
  "src/features/public-chatbot/components/demo-chat-launcher.tsx",
];

/** Resolves an `@/`-aliased or relative specifier to a file on disk. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join(root, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(path.join(root, fromFile)), specifier);
  } else {
    return null; // a package, not our code
  }

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      try {
        if (readFileSync(candidate).length >= 0) return path.relative(root, candidate).split(path.sep).join("/");
      } catch {
        // A directory matched the bare path; keep looking.
      }
    }
  }
  return null;
}

function importsOf(file: string): string[] {
  const source = readFileSync(path.join(root, file), "utf8");
  const specifiers: string[] = [];
  // Static imports, `export ... from`, and dynamic `import("...")`.
  for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Every first-party module reachable from the entry points. */
function reachableModules(): string[] {
  const seen = new Set<string>();
  const queue = [...ENTRY_POINTS];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(file)) {
      const resolved = resolveSpecifier(specifier, file);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen];
}

/**
 * The one exception, and why it is safe.
 *
 * `toErrorResponse()` has to recognise a database outage, so every route -
 * including this one - imports the error class. It is a dependency-free leaf
 * module holding a subclass of Error: no pool, no schema, no query. Keeping it
 * separate from `client.ts` is what makes the rest of this list true.
 */
const ALLOWED_MODULES = new Set(["src/server/db/errors.ts"]);

/** Modules a public, tenant-less demo must never be able to reach. */
const FORBIDDEN_MODULE_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /^src\/server\/db\//, why: "database access" },
  { pattern: /-repository\.ts$/, why: "a tenant repository" },
  { pattern: /^src\/server\/auth\//, why: "sessions and authorization" },
  { pattern: /^src\/features\/workspaces\//, why: "tenant membership" },
  { pattern: /^src\/features\/crm\//, why: "customer records" },
  { pattern: /^src\/features\/conversations\//, why: "customer conversations" },
  { pattern: /^src\/features\/knowledge\//, why: "customer knowledge bases" },
  { pattern: /^src\/features\/embed\/server\//, why: "embed token signing" },
  { pattern: /api-key/, why: "API keys" },
  { pattern: /secret-box/, why: "credential encryption" },
];

describe("public demo isolation", () => {
  const modules = reachableModules();

  it("reaches the modules it is supposed to", () => {
    // A sanity check on the walker itself: if resolution silently failed, the
    // forbidden-module assertions below would pass for the wrong reason.
    expect(modules).toContain("src/features/public-chatbot/server/demo-chat.ts");
    expect(modules).toContain("src/features/docs/grounding.ts");
    expect(modules).toContain("src/server/ai/index.ts");
    expect(modules.length).toBeGreaterThan(8);
  });

  it("cannot reach the database, a repository, sessions or any credential", () => {
    const violations: string[] = [];
    for (const moduleId of modules) {
      if (ALLOWED_MODULES.has(moduleId)) continue;
      for (const { pattern, why } of FORBIDDEN_MODULE_PATTERNS) {
        if (pattern.test(moduleId)) violations.push(`${moduleId} (${why})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("never loads the connection pool or the table schema", () => {
    // The sharpest version of the rule: even importing these would mean the
    // demo could open a connection. It has no reason to, and now it cannot.
    expect(modules).not.toContain("src/server/db/client.ts");
    expect(modules.filter((module) => module.startsWith("src/server/db/schema/"))).toEqual([]);
  });

  it("never names a workspace, tenant or chatbot id in its own source", () => {
    // The request contract has no tenant identifier at all, so there is no
    // field an attacker could aim at another customer's data.
    const ownFiles = modules.filter((module) => module.startsWith("src/features/public-chatbot/") || module.includes("api/public/demo"));
    const offenders: string[] = [];
    for (const file of ownFiles) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const source = readFileSync(path.join(root, file), "utf8");
      // Comments explain the isolation, so only real code is inspected.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const term of ["workspaceId", "workspace_id", "chatbotId", "embedKey", "apiKey", "tenantId"]) {
        if (code.includes(term)) offenders.push(`${file} mentions ${term}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("public demo secrets", () => {
  const ownSources = [
    "src/features/public-chatbot/constants.ts",
    "src/features/public-chatbot/schemas.ts",
    "src/features/public-chatbot/server/demo-chat.ts",
    "src/features/public-chatbot/components/demo-chat-launcher.tsx",
    "src/features/public-chatbot/components/demo-chat-dialog.tsx",
    "src/features/public-chatbot/components/suggested-prompts.tsx",
    "src/app/api/public/demo/chat/route.ts",
  ];

  it("ships no credential to the browser", () => {
    const offenders: string[] = [];
    for (const file of ownSources) {
      const source = readFileSync(path.join(root, file), "utf8");
      // NEXT_PUBLIC_* is inlined into the client bundle, so a secret there is
      // published. The demo needs no configuration at all, public or not.
      if (source.includes("NEXT_PUBLIC_")) offenders.push(`${file} reads a NEXT_PUBLIC_ variable`);
      if (/dot_live_[A-Za-z0-9_-]{16,}/.test(source)) offenders.push(`${file} contains something shaped like an API key`);
      if (/sk-[A-Za-z0-9]{16,}/.test(source)) offenders.push(`${file} contains something shaped like a provider key`);
    }
    expect(offenders).toEqual([]);
  });

  it("reads environment only on the server", () => {
    const clientFiles = ownSources.filter((file) => file.includes("/components/"));
    for (const file of clientFiles) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source, `${file} must not read process.env`).not.toMatch(/process\.env/);
      expect(source, `${file} must not import the server env`).not.toMatch(/@\/config\/env/);
    }
  });
});
