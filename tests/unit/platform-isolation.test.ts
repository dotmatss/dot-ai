// @vitest-environment node
/**
 * Keeps the cross-tenant reads inside the plane that is allowed to make them.
 *
 * `platform-repository.ts` deliberately queries without a workspace scope. That
 * is legitimate where a platform admin has already been resolved, and a breach
 * anywhere else: one careless
 * `import { listOrganizations } from "@/features/platform/server/..."` inside a
 * customer feature would hand a `workspaceRoute` handler the ability to read
 * every tenant, and nothing at runtime would complain, because the SQL is
 * perfectly valid and Row Level Security is permissive when unscoped.
 *
 * So the property is asserted structurally, the way `mcp-isolation` and
 * `public-chatbot-isolation` assert theirs: by reading how the code is
 * DECLARED, because this has no runtime symptom until it is already a breach.
 *
 * Two claims:
 *
 *   1. Only the platform plane imports the platform server modules.
 *   2. The cross-tenant reads never select a credential column.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..");

/** Modules that may only be imported from inside the platform plane. */
const PRIVILEGED_MODULES = [
  "@/features/platform/server/platform-repository",
  "@/features/platform/server/platform-service",
  "@/features/platform/server/platform-overview",
];

/**
 * Where a privileged import is legitimate.
 *
 * The platform feature itself, its routes and pages, and the two server
 * modules that exist to guard it. Anything else is a customer surface.
 */
const ALLOWED_PREFIXES = [
  path.join("src", "features", "platform"),
  path.join("src", "app", "admin"),
  path.join("src", "app", "api", "admin"),
  path.join("src", "server", "platform"),
  path.join("tests", "unit"),
];

function sourceFiles(dir: string): string[] {
  const absolute = path.join(root, dir);
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const relative = path.join(dir, entry);
    if (statSync(path.join(root, relative)).isDirectory()) {
      out.push(...sourceFiles(relative));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(relative);
    }
  }
  return out;
}

function isAllowed(file: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

describe("platform plane isolation", () => {
  it("is the only plane that imports the cross-tenant modules", () => {
    const offenders: string[] = [];

    for (const file of [...sourceFiles("src"), ...sourceFiles("tests")]) {
      if (isAllowed(file)) continue;
      const source = readFileSync(path.join(root, file), "utf8");
      for (const specifier of PRIVILEGED_MODULES) {
        if (source.includes(specifier)) offenders.push(`${file} -> ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("never selects a credential column in a cross-tenant read", () => {
    const raw = readFileSync(
      path.join(root, "src", "features", "platform", "server", "platform-repository.ts"),
      "utf8",
    );

    // Comments are stripped first. The file's own documentation NAMES these
    // columns in order to say it does not read them, and a check that cannot
    // tell prose from SQL would either fail on that sentence or force the
    // documentation to stop being specific.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    // Column names, not concepts: these are the actual columns in this schema
    // that hold or hash a secret. The operator plane has no reason to read any
    // of them, and reading one would put it in an API response.
    const forbidden = [
      "password_hash",
      "token_hash",
      "key_hash",
      "ciphertext",
      "secret_ref",
      "access_token",
      "refresh_token",
    ];

    expect(forbidden.filter((column) => source.includes(column))).toEqual([]);
  });

  it("keeps the platform guard out of every customer route", () => {
    // The inverse of the first check. A customer route that reached for
    // `requirePlatformAccess` would be mixing the two authorization models,
    // which is exactly the confusion this plane exists to prevent.
    const offenders = sourceFiles(path.join("src", "app", "api", "v1"))
      .concat(sourceFiles(path.join("src", "app", "w")))
      .filter((file) => {
        const source = readFileSync(path.join(root, file), "utf8");
        return source.includes("platform-dal") || source.includes("platformRoute");
      });

    expect(offenders).toEqual([]);
  });
});
